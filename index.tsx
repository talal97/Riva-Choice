import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';

interface OrganizedImage {
    id: string;
    file: File;
    url: string;
    prefix?: string;
}

const App = () => {
    const [files, setFiles] = useState<File[]>([]);
    const [organizedImages, setOrganizedImages] = useState<Map<string, OrganizedImage[]>>(new Map());
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessingFiles, setIsProcessingFiles] = useState(false);
    const [isZippingAll, setIsZippingAll] = useState(false);
    const [zippingFolder, setZippingFolder] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [draggedItem, setDraggedItem] = useState<{ group: string; index: number } | null>(null);
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
    const [thumbnailWidth, setThumbnailWidth] = useState(280);
    const [filenamePrefix, setFilenamePrefix] = useState('eci');
    
    // State for new features
    const [editingSku, setEditingSku] = useState<string | null>(null);
    const [draggedGroupSku, setDraggedGroupSku] = useState<string | null>(null);
    const [showDriveHelper, setShowDriveHelper] = useState(false);
    
    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxImages, setLightboxImages] = useState<OrganizedImage[]>([]);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    const isAnyZipping = isZippingAll || zippingFolder !== null;

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prevTheme => prevTheme === 'dark' ? 'light' : 'dark');
    };

    // Cleanup object URLs to prevent memory leaks
    useEffect(() => {
        return () => {
            // This cleanup now only runs when the component unmounts.
            // The `clearOrganizedImages` function handles cleanup during re-organization.
            organizedImages.forEach(imageGroup => {
                imageGroup.forEach(img => URL.revokeObjectURL(img.url));
            });
        };
    }, []);

    const clearOrganizedImages = () => {
        organizedImages.forEach(imageGroup => {
            imageGroup.forEach(img => URL.revokeObjectURL(img.url));
        });
        setOrganizedImages(new Map());
    };

    const extractImagesFromZip = async (zipFile: File): Promise<File[]> => {
        try {
            const zip = await JSZip.loadAsync(zipFile);
            const imageFilePromises: Promise<File>[] = [];
            
            zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && /\.(jpe?g|png|gif|webp)$/i.test(zipEntry.name)) {
                    const promise = zipEntry.async('blob').then(blob => {
                        const filename = zipEntry.name.split('/').pop() || zipEntry.name;
                        return new File([blob], filename, { type: blob.type });
                    });
                    imageFilePromises.push(promise);
                }
            });
    
        return await Promise.all(imageFilePromises);
        } catch (error) {
            console.error("Error reading zip file:", error);
            throw new Error(`Failed to read ${zipFile.name}. It may be corrupt or an unsupported format.`);
        }
    };

    const processAndSetFiles = async (incomingFiles: File[]) => {
        setIsProcessingFiles(true);
        clearOrganizedImages();
        setFiles([]);
        setError(null);
    
        try {
            const imageFiles: File[] = [];
            const zipProcessingPromises: Promise<File[]>[] = [];
    
            for (const file of incomingFiles) {
                const fileExtension = file.name.split('.').pop()?.toLowerCase();
                const isZip = file.type.includes('zip') || fileExtension === 'zip';
    
                if (isZip) {
                    zipProcessingPromises.push(extractImagesFromZip(file));
                } else if (file.type.startsWith('image/')) {
                    imageFiles.push(file);
                }
            }
    
            const zipResults = await Promise.allSettled(zipProcessingPromises);
            
            const extractedFromZips: File[] = [];
            const processingErrors: string[] = [];
    
            zipResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    extractedFromZips.push(...result.value);
                } else {
                    if (result.reason instanceof Error) {
                        processingErrors.push(result.reason.message);
                    } else {
                        processingErrors.push("An unknown zip processing error occurred.");
                    }
                }
            });
    
            setFiles([...imageFiles, ...extractedFromZips]);
    
            if (processingErrors.length > 0) {
                setError(`Some files failed to process: ${processingErrors.join('; ')}`);
            }
    
        } catch (err) {
            setError(err instanceof Error ? err.message : "An unknown error occurred during file processing.");
            console.error(err);
        } finally {
            setIsProcessingFiles(false);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            processAndSetFiles(Array.from(event.target.files));
        }
    };

    const getSkuFromFilename = (filename: string) => {
        const skuRegex = /(\d{6}-\d{5}-\d{3})/;
        const match = filename.match(skuRegex);
        if (match && match[1]) return match[1];

        let name = filename.split('.').slice(0, -1).join('.').trim();
        name = name.replace(/\s*\([^)]*\)$/, '');
        let previousName;
        do {
            previousName = name;
            name = name.replace(/[-_]\d+$|[-_]$/, '');
        } while (name !== previousName && name.length > 0);
        return name || filename.split('.').slice(0, -1).join('.').trim();
    };


    const organizeImages = () => {
        if (files.length === 0) {
            setError("Please select some images first.");
            return;
        }
        setIsLoading(true);
        setError(null);
        clearOrganizedImages();
        
        setTimeout(() => {
            try {
                const newOrganizedImages = new Map<string, OrganizedImage[]>();
                files.forEach((file) => {
                    const sku = getSkuFromFilename(file.name);
                    const groupName = sku || 'Unidentified';
                    const existing = newOrganizedImages.get(groupName) || [];
                    existing.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
                    newOrganizedImages.set(groupName, existing);
                });
                setOrganizedImages(newOrganizedImages);
            } catch (err) {
                setError(err instanceof Error ? err.message : "An unknown error occurred.");
            } finally {
                setIsLoading(false);
            }
        }, 50);
    };

    const handleDuplicateImage = (sku: string, index: number) => {
        setOrganizedImages(prev => {
            // FIX: Explicitly type `new Map()` to ensure correct type inference for map values.
            const newMap = new Map<string, OrganizedImage[]>(prev);
            const imageGroup = newMap.get(sku);
            if (!imageGroup) return prev;

            const originalImage = imageGroup[index];
            if (!originalImage) return prev;

            const duplicatedImage: OrganizedImage = {
                ...originalImage,
                id: crypto.randomUUID(),
            };

            const newImageGroup = [...imageGroup];
            newImageGroup.splice(index + 1, 0, duplicatedImage);
            newMap.set(sku, newImageGroup);

            return newMap;
        });
    };

    const handleDeleteImage = (sku: string, imageId: string) => {
        setOrganizedImages(prev => {
            // FIX: Explicitly type `new Map()` to ensure correct type inference for map values.
            const newMap = new Map<string, OrganizedImage[]>(prev);
            const imageGroup = newMap.get(sku);
            if (!imageGroup) return prev;

            const imageToDelete = imageGroup.find(img => img.id === imageId);
            if (imageToDelete) {
                URL.revokeObjectURL(imageToDelete.url);
            }

            const newImageGroup = imageGroup.filter(img => img.id !== imageId);

            if (newImageGroup.length > 0) {
                newMap.set(sku, newImageGroup);
            } else {
                newMap.delete(sku);
            }
            return newMap;
        });
    };
    
    const handleDeleteGroup = (sku: string) => {
        if (window.confirm(`Are you sure you want to delete the entire "${sku}" group?`)) {
            setOrganizedImages(prev => {
                // FIX: Explicitly type `new Map()` to ensure correct type inference for map values.
                const newMap = new Map<string, OrganizedImage[]>(prev);
                const groupToDelete = newMap.get(sku);
                
                if (groupToDelete) {
                    groupToDelete.forEach(img => URL.revokeObjectURL(img.url));
                }

                newMap.delete(sku);
                return newMap;
            });
        }
    };

    const handleDownloadAll = async () => {
        if (organizedImages.size === 0 || isAnyZipping) return;
        setIsZippingAll(true);
        setError(null);
        try {
            const zip = new JSZip();
            organizedImages.forEach((imageGroup, sku) => {
                const folder = zip.folder(sku);
                if (folder) {
                    imageGroup.forEach((image, index) => {
                        const { file } = image;
                        const effectivePrefix = (image.prefix === undefined ? filenamePrefix : image.prefix).trim();
                        const newFilename = effectivePrefix ? `${index + 1}-${effectivePrefix}-${file.name}` : `${index + 1}-${file.name}`;
                        folder.file(newFilename, file);
                    });
                }
            });
            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = 'organized_images.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create zip file.");
        } finally {
            setIsZippingAll(false);
        }
    };
    
    const handleDownloadSingleFolder = async (sku: string, imageDatas: OrganizedImage[]) => {
        if (isAnyZipping) return;
        setZippingFolder(sku);
        setError(null);
        try {
            const zip = new JSZip();
            imageDatas.forEach((image, index) => {
                const { file } = image;
                const effectivePrefix = (image.prefix === undefined ? filenamePrefix : image.prefix).trim();
                const newFilename = effectivePrefix ? `${index + 1}-${effectivePrefix}-${file.name}` : `${index + 1}-${file.name}`;
                zip.file(newFilename, file);
            });
            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `${sku}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to create zip file for ${sku}.`);
        } finally {
            setZippingFolder(null);
        }
    };

    const handleDropUpload = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');
        if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
            processAndSetFiles(Array.from(event.dataTransfer.files));
        }
    }, []);

    const handleDragOverUpload = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
    };
    
    const handleDragEnterUpload = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.add('drag-over');
    };

    const handleDragLeaveUpload = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');
    };

    // --- SKU Editing ---
    const handleSkuChange = (oldSku: string, newSku: string) => {
        if (!newSku || oldSku === newSku) {
            setEditingSku(null);
            return;
        }

        setOrganizedImages(prev => {
            // FIX: Explicitly type `new Map()` to ensure correct type inference for map values.
            const newMap = new Map<string, OrganizedImage[]>(prev);
            const images = newMap.get(oldSku) || [];
            newMap.delete(oldSku);

            if (newMap.has(newSku)) { // Merge with existing group
                const existingImages = newMap.get(newSku) || [];
                newMap.set(newSku, [...existingImages, ...images]);
            } else { // Rename group
                newMap.set(newSku, images);
            }
            return newMap;
        });
        setEditingSku(null);
    };

    // --- Per-Image Prefix Editing ---
    const handleImagePrefixChange = (sku: string, imageId: string, newPrefix: string) => {
        setOrganizedImages(prev => {
            const newMap = new Map<string, OrganizedImage[]>(prev);
            const imageGroup = newMap.get(sku);
            if (!imageGroup) return prev;
    
            const newImageGroup = imageGroup.map(img => {
                if (img.id === imageId) {
                    return { ...img, prefix: newPrefix };
                }
                return img;
            });
    
            newMap.set(sku, newImageGroup);
            return newMap;
        });
    };

    // --- Image Drag & Drop ---
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, group: string, index: number) => {
        e.stopPropagation(); // Prevent group drag from firing
        e.dataTransfer.setData('text/plain', ''); 
        e.dataTransfer.effectAllowed = 'move';
        setDraggedItem({ group, index });
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); 
    };

    const handleDragEnterReorder = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.currentTarget.classList.contains('dragging')) return;
        e.currentTarget.classList.add('drag-over-item');
    };
    
    const handleDragLeaveReorder = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over-item');
    };

    const handleDropReorder = (e: React.DragEvent<HTMLDivElement>, targetGroup: string, targetIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('drag-over-item');
        if (!draggedItem) return;

        const { group: sourceGroup, index: sourceIndex } = draggedItem;

        setOrganizedImages(prev => {
            // FIX: Explicitly type `new Map()` to ensure correct type inference for map values.
            const newMap = new Map<string, OrganizedImage[]>(prev);
            const sourceImageGroup = [...(newMap.get(sourceGroup) || [])];
            const [removed] = sourceImageGroup.splice(sourceIndex, 1);
            
            if (sourceGroup === targetGroup) {
                sourceImageGroup.splice(targetIndex, 0, removed);
                newMap.set(sourceGroup, sourceImageGroup);
            } else {
                const targetImageGroup = [...(newMap.get(targetGroup) || [])];
                targetImageGroup.splice(targetIndex, 0, removed);
                newMap.set(targetGroup, targetImageGroup);
                if (sourceImageGroup.length === 0) {
                    newMap.delete(sourceGroup);
                } else {
                    newMap.set(sourceGroup, sourceImageGroup);
                }
            }
            return newMap;
        });
    };

    const handleDragEnd = () => {
        document.querySelectorAll('.drag-over-item').forEach(el => el.classList.remove('drag-over-item'));
        setDraggedItem(null);
    };

    // --- Group Merging Drag & Drop ---
    const handleGroupDragStart = (e: React.DragEvent<HTMLDivElement>, sku: string) => {
        e.dataTransfer.setData('application/json', sku);
        e.dataTransfer.effectAllowed = 'move';
        setDraggedGroupSku(sku);
    };

    const handleGroupDrop = (e: React.DragEvent<HTMLDivElement>, targetSku: string) => {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.merge-target').forEach(el => el.classList.remove('merge-target'));
        if (!draggedGroupSku || draggedGroupSku === targetSku) return;

        setOrganizedImages(prev => {
            // FIX: Explicitly type `new Map()` to ensure correct type inference for map values.
            const newMap = new Map<string, OrganizedImage[]>(prev);
            const sourceImages = newMap.get(draggedGroupSku) || [];
            const targetImages = newMap.get(targetSku) || [];
            newMap.set(targetSku, [...targetImages, ...sourceImages]);
            newMap.delete(draggedGroupSku);
            return newMap;
        });
        setDraggedGroupSku(null);
    };

    const handleGroupDragEnter = (e: React.DragEvent<HTMLDivElement>, targetSku: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggedGroupSku && draggedGroupSku !== targetSku) {
            e.currentTarget.classList.add('merge-target');
        } else if (draggedItem && draggedItem.group !== targetSku) {
            e.currentTarget.classList.add('image-drop-target');
        }
    };
    
    const handleGroupDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('merge-target', 'image-drop-target');
    };
    
    const handleGroupDragEnd = () => {
        setDraggedGroupSku(null);
    };

    // Lightbox handlers
    const openLightbox = (images: OrganizedImage[], index: number) => {
        setLightboxImages(images);
        setLightboxIndex(index);
        setLightboxOpen(true);
    };
    const closeLightbox = () => setLightboxOpen(false);
    const showNextImage = () => setLightboxIndex(prev => (prev + 1) % lightboxImages.length);
    const showPrevImage = () => setLightboxIndex(prev => (prev - 1 + lightboxImages.length) % lightboxImages.length);

    return (
        <div className="container">
            <header>
                <h1>Riva Choice</h1>
                <p>Organize product images by SKU/name, sort, preview, and download.</p>
                <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
                    {theme === 'dark' ? '🌙' : '☀️'}
                </button>
            </header>

            <main>
                <div className="upload-container">
                    <div className="drop-zone" onDrop={handleDropUpload} onDragOver={handleDragOverUpload} onDragEnter={handleDragEnterUpload} onDragLeave={handleDragLeaveUpload} onClick={() => document.getElementById('file-input')?.click()}>
                        <input type="file" id="file-input" multiple accept="image/*,.zip" onChange={handleFileChange} style={{ display: 'none' }} aria-label="File Uploader" />
                         <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        <span>Drag and drop images & .zip files here or <a>click to browse</a></span>
                         <p className="upload-hint">You can select and process multiple files at the same time.</p>
                    </div>
                    <div className="drive-import-separator">OR</div>
                    <div className="drive-import-container">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        <span className="drive-import-text">Importing from Google Drive, Dropbox, etc?</span>
                        <button onClick={() => setShowDriveHelper(true)}>Show Me How</button>
                    </div>
                    <div className="controls-bar">
                        <button className="primary" onClick={organizeImages} disabled={isProcessingFiles || isLoading || files.length === 0}>{isProcessingFiles ? "Processing..." : isLoading ? "Organizing..." : "Organize Images"}</button>
                        <button onClick={handleDownloadAll} disabled={isAnyZipping || organizedImages.size === 0}>{isZippingAll ? 'Zipping...' : 'Download All (.zip)'}</button>
                        <span className="file-count">{files.length > 0 && `${files.length} file${files.length > 1 ? 's' : ''} selected`}</span>
                        <div className="prefix-control">
                            <label htmlFor="prefix-input">Global Prefix</label>
                            <input
                                id="prefix-input"
                                type="text"
                                value={filenamePrefix}
                                onChange={(e) => setFilenamePrefix(e.target.value)}
                                placeholder="e.g. eci"
                            />
                        </div>
                        <div className="slider-control">
                            <label htmlFor="thumb-width">Thumbnail width</label>
                            <input type="range" id="thumb-width" min="180" max="500" value={thumbnailWidth} onChange={(e) => setThumbnailWidth(Number(e.target.value))} />
                            <span>{thumbnailWidth}px</span>
                        </div>
                    </div>
                </div>
                
                {isLoading && <div className="loader-container"><div className="loader"></div><p>Organizing your images...</p></div>}
                {error && <div className="error-message">{error}</div>}

                {organizedImages.size > 0 && (
                    <div className="results-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailWidth}px, 1fr))` }}>
                        {[...organizedImages.entries()].map(([sku, imageDatas]) => (
                            <div key={sku} className={`group-card ${draggedGroupSku === sku ? 'group-dragging' : ''}`}
                                draggable
                                onDragStart={(e) => handleGroupDragStart(e, sku)}
                                onDrop={(e) => handleGroupDrop(e, sku)}
                                onDragOver={handleDragOver}
                                onDragEnter={(e) => handleGroupDragEnter(e, sku)}
                                onDragLeave={handleGroupDragLeave}
                                onDragEnd={handleGroupDragEnd}
                            >
                                <div className="group-header">
                                    <div className="group-info">
                                    {editingSku === sku ? (
                                        <input
                                            type="text"
                                            defaultValue={sku}
                                            className="sku-input"
                                            autoFocus
                                            onBlur={(e) => handleSkuChange(sku, e.target.value.trim())}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSkuChange(sku, e.currentTarget.value.trim());
                                                if (e.key === 'Escape') setEditingSku(null);
                                            }}
                                            onClick={e => e.stopPropagation()} // Prevent card drag
                                        />
                                    ) : (
                                        <span className="group-name" title={sku} onClick={(e) => { e.stopPropagation(); setEditingSku(sku); }}>{sku}</span>
                                    )}
                                      <span className="image-count">{imageDatas.length} image{imageDatas.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div className="group-header-actions">
                                        <button className="download-folder-btn" onClick={() => handleDownloadSingleFolder(sku, imageDatas)} disabled={isAnyZipping} title={`Download ${sku}.zip`} aria-label={`Download ${sku}.zip`}>
                                            {zippingFolder === sku ? <div className="mini-loader"></div> : 'Download Folder'}
                                        </button>
                                        <button 
                                            className="delete-group-btn" 
                                            onClick={(e) => { e.stopPropagation(); handleDeleteGroup(sku); }} 
                                            title={`Delete ${sku} group`} 
                                            aria-label={`Delete ${sku} group`}
                                            disabled={isAnyZipping}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="image-grid-inner" onDrop={(e) => handleDropReorder(e, sku, imageDatas.length)}>
                                    {imageDatas.map((imageData, index) => {
                                        const {id, url, file, prefix} = imageData;
                                        return (
                                        <div
                                            key={id}
                                            className={`image-container ${draggedItem?.group === sku && draggedItem?.index === index ? 'dragging' : ''}`}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, sku, index)}
                                            onDragOver={handleDragOver}
                                            onDragEnter={handleDragEnterReorder}
                                            onDragLeave={handleDragLeaveReorder}
                                            onDrop={(e) => handleDropReorder(e, sku, index)}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <div className="image-wrapper" onClick={() => openLightbox(imageDatas, index)}>
                                                <img src={url} alt={file.name} loading="lazy" />
                                                <span className="image-sequence">{index + 1}</span>
                                                <div className="image-overlay">
                                                    <div className="image-actions">
                                                        <button 
                                                            className="image-action-btn duplicate-btn" 
                                                            title="Duplicate Image" 
                                                            aria-label="Duplicate Image"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDuplicateImage(sku, index);
                                                            }}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                        </button>
                                                        <button
                                                            className="image-action-btn delete-btn"
                                                            title="Delete Image"
                                                            aria-label="Delete Image"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteImage(sku, id);
                                                            }}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="image-details">
                                                <input
                                                    type="text"
                                                    className="image-prefix-input"
                                                    placeholder={filenamePrefix}
                                                    value={prefix || ''}
                                                    onChange={(e) => handleImagePrefixChange(sku, id, e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    aria-label="Image-specific prefix"
                                                />
                                                <span className="image-name" title={file.name}>{file.name}</span>
                                            </div>
                                        </div>
                                    )})}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {lightboxOpen && (
                <div className="lightbox" onClick={closeLightbox}>
                    <button className="lightbox-close" aria-label="Close" onClick={closeLightbox}>&times;</button>
                    <button className="lightbox-nav lightbox-prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); showPrevImage(); }}>&#10094;</button>
                    <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                        <img src={lightboxImages[lightboxIndex].url} alt={lightboxImages[lightboxIndex].file.name} />
                    </div>
                    <button className="lightbox-nav lightbox-next" aria-label="Next" onClick={(e) => { e.stopPropagation(); showNextImage(); }}>&#10095;</button>
                </div>
            )}

            {showDriveHelper && (
                <div className="modal-overlay" onClick={() => setShowDriveHelper(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M19.143 7.5H4.857L12 18.214L19.143 7.5Z" fill="#34A853"/><path d="M4.857 7.5L0 18.214h9.714L4.857 7.5Z" fill="#0F9D58"/><path d="M12 0L7.286 7.5h9.428L12 0Z" fill="#FFC107"/><path d="M19.143 7.5L14.286 18.214H24L19.143 7.5Z" fill="#4285F4"/><path d="M12 18.214l-4.857-7.5h9.714L12 18.214Z" fill="#1A73E8"/><path d="M7.286 7.5L12 0l4.857 7.5H7.286Z" fill="#FFEB3B"/></svg>
                            How to Import from Google Drive
                        </h3>
                        <p>Directly connecting to cloud services isn't supported for security reasons. But here’s the best way to import your images!</p>
                        <ol>
                            <li>Go to your Google Drive folder (or Dropbox, etc.).</li>
                            <li>Use the platform's 'Download' option for your folder. They will package it into a <strong>.zip</strong> file for you.</li>
                            <li>Once downloaded, simply drag and drop that <strong>single .zip file</strong> onto the upload area.</li>
                        </ol>
                        <p>The app will automatically extract and load all your images from the zip!</p>
                        <button className="primary" onClick={() => setShowDriveHelper(false)}>Got it!</button>
                    </div>
                </div>
            )}
        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);