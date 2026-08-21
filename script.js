// Lock screen height variable once on load to prevent mobile toolbar vh jumps
function setStableAppHeight() {
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
setStableAppHeight();
window.addEventListener('orientationchange', setStableAppHeight);

// --- TIMELINE CONSTANTS ---
const minYear = 1800;
const maxYear = 2100;
const pixelsPerYear = 100; 

// Base overlap steps at 1x zoom
const verticalOffsetStep = 50;    // Increased from 70 to peek out vertically
const horizontalOffsetStep = 25;   // Increased from 22 to fan out horizontally
const minScreenGap = 120;

// THE FIX: Move the animation speed here so it is easy to tweak!
const glideSpeed = 0.4; // 0.05 is very floaty, 0.15 is balanced, 0.4 is snappy

// --- MOBILE TOUCH CONSTANTS ---
const touchFriction = 0.92;         // 0.98 is very icy, 0.85 is heavy/sticky
const touchVelocityMultiplier = 16; // How forcefully a flick throws the canvas
const touchCancelTimer = 50;        // ms of finger resting before momentum is canceled
const touchMinFlickSpeed = 0.1;     // Minimum velocity to trigger momentum
const touchStopThreshold = 0.05;    // When the sliding animation goes to sleep

// --- INTERACTION STATE ---
let targetScale = 0.1; // Where the zoom WANTS to be
let scale = targetScale; // Where the zoom ACTUALLY is

const targetYear = 1950;
const targetX = (targetYear - minYear) * pixelsPerYear;

let targetTranslateX = (window.innerWidth / 2) - (targetX * targetScale);
let translateX = targetTranslateX;
let translateY = 0;

let isDragging = false;
let startX, startY;
let loadedItems = []; 
let zoomTimeout;

const viewport = document.getElementById('viewport');
const track = document.getElementById('track');

const worldEventsTrack = document.createElement('div');
worldEventsTrack.id = 'world-events-track';
track.appendChild(worldEventsTrack);

const culturalErasTrack = document.createElement('div');
culturalErasTrack.id = 'cultural-eras-track';
track.appendChild(culturalErasTrack);

// --- 1. FETCH JSON DATA ---
async function loadData() {
    try {
        const response = await fetch('data.json');
        const data = await response.json();
        
        // Sort by year first. If same year, high priority (1) goes first.
        loadedItems = data.items.sort((a, b) => {
            if (a.year === b.year) return (a.priority || 2) - (b.priority || 2);
            return a.year - b.year;
        });
        
        renderGridLines();
        renderItems(loadedItems); 
        
        // NEW: Render the semantic context timelines if they exist
        if (data.contexts) renderContexts(data.contexts); 

    } catch (error) {
        console.error("Error loading data.json", error);
    }
}

// --- 2. DRAW TIMELINE GRID (Centuries & Decades) ---
function renderGridLines() {
    for (let year = minYear; year <= maxYear; year++) {
        if (year % 10 === 0) {
            const xPos = (year - minYear) * pixelsPerYear;
            
            // Draw the line
            const line = document.createElement('div');
            line.className = year % 100 === 0 ? 'century-line' : 'decade-line';
            line.style.left = `${xPos}px`;
            track.appendChild(line);
            
            // Draw the year label
            const label = document.createElement('div');
            label.className = 'year-label';
            label.style.left = `${xPos}px`;
            label.innerText = year;
            
            // FIX: Bump to 700 (Bold) or 800 (Extra Bold)
            if (year % 100 === 0) {
                label.style.fontWeight = '700'; 
            }
            
            track.appendChild(label);
        }
    }
}
// --- 3. RENDER ITEMS ---
function renderItems(items) {
    items.forEach(item => {
        const xPos = (item.year - minYear) * pixelsPerYear;

        const el = document.createElement('div');
        el.className = 'timeline-item';
        
        item.baseX = xPos;
        item.priority = item.priority || 2; 
        el.style.left = `${xPos}px`;
        el.style.top = `0px`; 
        
        // 1. Build the image layer
        let html = '';
        if (item.image) {
            html += `<img src="${item.image}" class="item-image" alt="${item.title}">`;
            el.style.backgroundColor = 'transparent'; 
        }

        // 2. Build the info layer
        const hasDrawer = item.description || item.link;

        html += `
            <div class="item-info">
                <div class="info-header">
                    <div class="info-meta">
                        <div class="info-year">${item.year}</div>
                        <div class="info-title">${item.title}</div>
                    </div>
                    ${hasDrawer ? `<div class="info-toggle">+ info</div>` : ''}
                    <div class="close-btn">&times;</div>
                </div>
                
                ${hasDrawer ? `
                <div class="desc-mask">
                    <div class="info-desc-box">
                        ${item.description ? `<div>${item.description}</div>` : ''}
                        ${item.link ? `
                        <div class="wiki-link-container">
                            <a href="${item.link}" target="_blank" class="wiki-link" onclick="event.stopPropagation();">
                                <span>Wikipedia</span>
                                <svg class="wiki-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M7 17L17 7"></path>
                                    <path d="M7 7h10v10"></path>
                                </svg>
                            </a>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
                
            </div>
        `;
        
        el.innerHTML = html;
        
      // 3. Smart Click Logic (Aspect-Ratio Morph)
      el.addEventListener('click', (e) => {
        
        // THE FIX: Gatekeeper - If any context card is open, close it and abort opening the image!
        const openContextCards = document.querySelectorAll('.context-item.is-open');
        if (openContextCards.length > 0) {
            openContextCards.forEach(card => card.classList.remove('is-open'));
            return; 
        }

        const isTouchDevice = window.matchMedia("(hover: none)").matches;

        if (!isTouchDevice) {
            // DESKTOP: Native 1-click behavior
            if (item.link) window.open(item.link, '_blank');
            return;
        }

        // MOBILE: Clone Teleport Logic
        if (document.querySelector('.mobile-clone')) return;

        if (!isTouchDevice) {
            // DESKTOP: Native 1-click behavior
            if (item.link) window.open(item.link, '_blank');
            return;
        }

        // MOBILE: Clone Teleport Logic
        if (document.querySelector('.mobile-clone')) return; 

        // 1. Measure original card position
        const rect = el.getBoundingClientRect();
        const img = el.querySelector('.item-image');

        // 2. Calculate true expanded dimensions using natural image aspect ratio
        let targetWidth = window.innerWidth + 2; // Start with full width + 2px bleed
        const aspect = (img && img.naturalWidth) ? (img.naturalHeight / img.naturalWidth) : 0.65;
        let targetHeight = targetWidth * aspect;

        // THE CAP: Limit height to 60% of the screen so tall images don't cover the drawer
        const maxHeight = window.innerHeight * 0.60; 

        if (targetHeight > maxHeight) {
            targetHeight = maxHeight;
            targetWidth = targetHeight / aspect; // Scale width down proportionally
        }

        const targetTop = (window.innerHeight - targetHeight) / 2;
        
        // Dynamically center horizontally (results in -1px if full width with bleed)
        const targetLeft = (window.innerWidth - targetWidth) / 2;

        // 3. Create clone & place directly over original card
        const clone = el.cloneNode(true);
        clone.className = 'timeline-item mobile-clone'; 

        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;

        document.body.appendChild(clone);

        // Set up Description Drawer Arrow Toggle (Modern 2-Line Chevron)
        const descToggle = clone.querySelector('.info-toggle');
        if (descToggle) {
            descToggle.innerHTML = `
                <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
            `;
            descToggle.addEventListener('click', (toggleEvent) => {
                toggleEvent.stopPropagation(); 
                clone.classList.toggle('desc-open');
            });
        }

        // Hide original card on timeline
        el.style.opacity = '0';

        // 4. Force reflow to lock starting coordinates
        clone.offsetHeight; 

        // 5. Animate to explicit target coordinates
        clone.classList.add('is-expanded');
        clone.style.left = `${targetLeft}px`; 
        clone.style.top = `${targetTop}px`;
        clone.style.width = `${targetWidth}px`; 
        clone.style.height = `${targetHeight}px`;

        // Lock background interactions
        document.body.classList.add('has-expanded-clone');

        // UNIFIED CLOSE LOGIC
        const closeClone = () => {
            document.removeEventListener('click', handleOutsideTap);
            document.body.classList.remove('has-expanded-clone');

            const liveRect = el.getBoundingClientRect();
            
            clone.classList.remove('is-expanded');
            clone.style.left = `${liveRect.left}px`;
            clone.style.top = `${liveRect.top}px`;
            clone.style.width = `${liveRect.width}px`;
            clone.style.height = `${liveRect.height}px`;
            
            // THE FIX: The Mid-Air Crossfade!
            // At 200ms, reveal the perfectly-sorted original card, and smoothly 
            // dissolve the flying clone over top of it.
            setTimeout(() => {
                el.style.opacity = '1';
                clone.style.opacity = '0';
            }, 200);
            
            // At 400ms, the clone is invisible, so we can delete it safely.
            setTimeout(() => {
                clone.remove();
            }, 400); 
        };

        // Close listeners
        clone.querySelector('.close-btn').addEventListener('click', (btnEvent) => {
            btnEvent.stopPropagation();
            closeClone();
        });

        const handleOutsideTap = (tapEvent) => {
            if (!clone.contains(tapEvent.target)) {
                closeClone();
            }
        };

        setTimeout(() => {
            document.addEventListener('click', handleOutsideTap);
        }, 50);
 
    });

        // ==========================================
        // THE FIX: You accidentally deleted these 3 lines!
        track.appendChild(el);
        item.element = el;
    }); 
    // ==========================================

    updateTransform();
}

// --- RENDER CONTEXTS (Handles both Spans and Single Points) ---
function renderContexts(contexts) {
    let worldEventLanes = [];  
    let culturalEraLanes = []; 
    
    // Sort chronologically using either year or start
    contexts.sort((a, b) => (a.year || a.start) - (b.year || b.start));

    contexts.forEach(item => {
        // 1. Determine if this is a point-in-time or a duration
        const isPointEvent = item.year !== undefined;
        const startYear = isPointEvent ? item.year : item.start;
        const endYear = isPointEvent ? item.year : item.end;
        
        const startX = (startYear - minYear) * pixelsPerYear;
        // Point events have a width of 0, spans calculate normally
        const width = isPointEvent ? 0 : (endYear - startYear) * pixelsPerYear; 
        const endX = startX + width;
        
        const buffer = 150; 
        const isWorldEvent = item.type === 'world_event';
        let targetLanes = isWorldEvent ? worldEventLanes : culturalEraLanes;
        
        let assignedLane = 0;
        let placed = false;

        for (let i = 0; i < targetLanes.length; i++) {
            if (targetLanes[i] < startX) {
                assignedLane = i;
                targetLanes[i] = endX + buffer;
                placed = true;
                break;
            }
        }
        
        if (!placed) {
            assignedLane = targetLanes.length;
            targetLanes.push(endX + buffer);
        }

        const el = document.createElement('div');
        el.className = isPointEvent ? 'context-item point-event' : 'context-item';
        el.style.left = `${startX}px`;
        el.style.width = `${width}px`;
        
        const laneOffset = assignedLane * 45; 
        el.style.top = `calc(${isWorldEvent ? -laneOffset : laneOffset}px * var(--inv-scale, 1))`;

        // 2. Format Date Text (Single year vs Range)
        const dateText = isPointEvent ? `${startYear}` : `${startYear} - ${endYear}`;

        const imgHTML = item.image 
            ? `<img src="${item.image}" class="card-image" alt="${item.title}">` 
            : '';

        // THE FIX: We build the 'X' and Wikipedia link directly into the card HTML here!
        const descHTML = (item.description || item.image || item.link) 
            ? `<div class="context-card">
                 <div class="context-close">&times;</div>
                 ${imgHTML}
                 <div class="card-title">${item.title}</div>
                 <div class="card-year">${dateText}</div>
                 ${item.description ? `<div class="card-desc">${item.description}</div>` : ''}
                 ${item.link ? `
                 <div class="wiki-link-container">
                     <a href="${item.link}" target="_blank" class="wiki-link" onclick="event.stopPropagation();">
                         <span>Wikipedia</span>
                         <svg class="wiki-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                             <path d="M7 17L17 7"></path>
                             <path d="M7 7h10v10"></path>
                         </svg>
                     </a>
                 </div>
                 ` : ''}
               </div>`
            : '';

        // 3. Build Visual Graphics (Dot vs Line+Dots)
        const visualHTML = isPointEvent 
            ? `<div class="context-circle"></div>` 
            : `<div class="context-line"></div>
               <div class="context-dot start"></div>
               <div class="context-dot end"></div>`;

        el.innerHTML = `
            ${visualHTML}
            <div class="context-title">
                <span class="title-text">${item.title}</span>
                <span class="title-year">${dateText}</span>
                ${descHTML}
            </div>
        `;
        
        // THE FIX: Safe Click Logic (Replaces the old instant redirect)
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close any other open context cards first
            document.querySelectorAll('.context-item.is-open').forEach(openItem => {
                if (openItem !== el) openItem.classList.remove('is-open');
            });
            
            // Open this one
            el.classList.add('is-open');
        });

        // Close on 'X' tap
        const closeBtn = el.querySelector('.context-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                el.classList.remove('is-open');
            });
        }
        
        if (isWorldEvent) {
            worldEventsTrack.appendChild(el);
        } else {
            culturalErasTrack.appendChild(el);
        }
    });
}

// --- 4. SAFE CLUSTER STACKING & CASCADING FADE ---
function updateVerticalStacking() {
    if (!loadedItems.length) return;

    // 1. Dynamic steps based on zoom
    const dynamicVerticalStep = verticalOffsetStep * Math.max(1, 1 + (scale - 1) * 0.4);
    const horizontalFade = Math.max(0, 1 - (scale - 1) * 1.0);
    const dynamicHorizontalStep = horizontalOffsetStep * horizontalFade;
    
    // The hard limit where a cluster breaks
    const dynamicMinGap = minScreenGap * Math.max(0.65, 1 - (scale - 1) * 0.25);

    // 2. Priority Scale Boost
    const priorityBoostFactor = Math.max(0, 1 - (scale - 0.3) / 1.2);

    let clusters = [];
    let currentCluster = [];

    // Safe Grouping: Cards only cluster if they actually touch horizontally on screen
    loadedItems.forEach((item, index) => {
        item.globalIndex = index; // THE FIX 1: Lock a permanent index for UP/DOWN parity
        item.screenX = (item.year - minYear) * pixelsPerYear * scale;

        if (currentCluster.length === 0) {
            currentCluster.push(item);
        } else {
            const prevItem = currentCluster[currentCluster.length - 1];
            if (item.screenX - prevItem.screenX < dynamicMinGap) {
                currentCluster.push(item);
            } else {
                clusters.push(currentCluster);
                currentCluster = [item];
            }
        }
    });
    if (currentCluster.length > 0) clusters.push(currentCluster);

    // Apply positions with Cascading Fade
    clusters.forEach(cluster => {
        cluster.forEach((item, count) => {
            let yOffset = 0;
            let xOffset = 0;
            
            if (count === 0) item.sameYearIndex = 0;
            
            if (count > 0) {
                const prevItem = cluster[count - 1];
                const dist = item.screenX - prevItem.screenX;

                item.sameYearIndex = (item.year === prevItem.year) ? prevItem.sameYearIndex + 1 : 0;

                // Cards begin to unstack when they exceed 40% of the breaking gap
                const solidGap = dynamicMinGap * 0.4;
                let localFade = 1;
                if (dist > solidGap) {
                    localFade = 1 - ((dist - solidGap) / (dynamicMinGap - solidGap));
                    localFade = Math.max(0, Math.min(1, localFade));
                }

                // VERTICAL: Always stack so cards don't hide each other
                const yMultiplier = Math.ceil(count / 2);
                
                // THE FIX 2: Use the global parity so an item NEVER flips directions when clusters split!
                const yDirection = item.globalIndex % 2 === 1 ? -1 : 1; 
                
                // THE FIX 3: Apply the fade directly to the item so it smoothly settles back to the line
                yOffset = yMultiplier * yDirection * dynamicVerticalStep * localFade;
                
                // HORIZONTAL: Only fan out if they share the exact same year
                if (item.sameYearIndex > 0) {
                    const xMultiplier = Math.ceil(item.sameYearIndex / 2);
                    const xDirection = item.sameYearIndex % 2 === 1 ? -1 : 1;
                    xOffset = xMultiplier * xDirection * dynamicHorizontalStep * localFade;
                }
            }

            // PRIORITY MAGIC: Boost scale for Priority 1 items
            const isMajorMilestone = Number(item.priority) === 1;
            const itemPriorityScale = isMajorMilestone ? 1 + (0.35 * priorityBoostFactor) : 1;
            item.element.style.setProperty('--priority-scale', itemPriorityScale);
            
            // Apply scale-aware positions
            item.element.style.left = `calc(${item.baseX}px + (${xOffset}px * var(--inv-scale, 1)))`;
            item.element.style.top = `calc(${yOffset}px * var(--inv-scale, 1))`;
            
            // THE FIX: Locked Z-index based on global chronology!
            // Normal items start at 10. Major milestones get a massive +500 boost 
            // so they never get buried by a long timeline of normal items.
            const baseZ = isMajorMilestone ? 500 : 10;
            
            // We use globalIndex instead of count, so the stack order NEVER 
            // recalculates or fights during the smooth CSS glide!
            item.element.style.zIndex = baseZ + item.globalIndex;
        });
    });
}

// --- 5. UPDATE SCREEN ---
function updateTransform() {
    track.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    track.style.setProperty('--inv-scale', 1 / scale);
    
    updateVerticalStacking();
}

// --- 6. PAN LOGIC ---
viewport.addEventListener('mousedown', (e) => {
    if (document.body.classList.contains('has-expanded-clone')) return; // GATEKEEPER
    
    isDragging = true;
    startX = e.clientX - targetTranslateX;
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging || document.body.classList.contains('has-expanded-clone')) return; // GATEKEEPER
    
    let newX = e.clientX - startX;
    
    const trackWidth = (maxYear - minYear) * pixelsPerYear;
    const scaledWidth = trackWidth * targetScale;
    const padding = window.innerWidth / 2;
    
    const minX = -(scaledWidth - padding); 
    const maxX = padding;                  
    
    if (newX > maxX) {
        newX = maxX;
        startX = e.clientX - newX; 
    } else if (newX < minX) {
        newX = minX;
        startX = e.clientX - newX; 
    }
    
    targetTranslateX = newX;
    translateX = targetTranslateX; 
    
    updateTransform();
});

window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mouseleave', () => isDragging = false);

// --- MOBILE TOUCH LOGIC (PAN & ZOOM) ---
let lastTouchTime = 0;
let lastTouchXPos = 0;
let velocityX = 0;
let wasZooming = false; 

let initialPinchDistance = null;
let initialScale = 1;

viewport.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('has-expanded-clone')) return; // GATEKEEPER
    
    if (e.touches.length === 1) {
        if (!wasZooming) {
            isDragging = true;
            startX = e.touches[0].clientX - targetTranslateX;
            lastTouchXPos = e.touches[0].clientX;
            lastTouchTime = Date.now();
            velocityX = 0;
        }
    } else if (e.touches.length === 2) {
        isDragging = false; 
        wasZooming = true; 
        initialPinchDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = targetScale;
    }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    if (document.body.classList.contains('has-expanded-clone')) return; // GATEKEEPER
    
    if (e.touches.length === 1 && isDragging) {
        // ... (Keep your exact existing 1-finger panning math here) ...
        let currentClientX = e.touches[0].clientX;
        let newX = currentClientX - startX;
        
        let currentTime = Date.now();
        let dt = currentTime - lastTouchTime;
        if (dt > 0) {
            velocityX = (currentClientX - lastTouchXPos) / dt;
        }
        lastTouchXPos = currentClientX;
        lastTouchTime = currentTime;
        
        const trackWidth = (maxYear - minYear) * pixelsPerYear;
        const scaledWidth = trackWidth * targetScale;
        const padding = window.innerWidth / 2;
        const minX = -(scaledWidth - padding); 
        const maxX = padding;                  
        
        if (newX > maxX) {
            newX = maxX;
            startX = currentClientX - newX; 
        } else if (newX < minX) {
            newX = minX;
            startX = currentClientX - newX; 
        }
        
        targetTranslateX = newX;
        translateX = targetTranslateX; 
        updateTransform();
        
    } else if (e.touches.length === 2 && initialPinchDistance) {
        // ... (Keep your exact existing 2-finger zooming math here) ...
        e.preventDefault(); 
        
        const currentDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        
        let newScale = initialScale * (currentDistance / initialPinchDistance);
        newScale = Math.max(0.1, Math.min(newScale, 4)); 
        
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const xs = (midX - targetTranslateX) / targetScale;
        
        targetScale = newScale;
        targetTranslateX = midX - xs * targetScale;

        const trackWidth = (maxYear - minYear) * pixelsPerYear;
        const scaledWidth = trackWidth * targetScale;
        const padding = window.innerWidth / 2;
        const minX = -(scaledWidth - padding);
        const maxX = padding;

        targetTranslateX = Math.max(minX, Math.min(maxX, targetTranslateX));
    }
}, { passive: false });

window.addEventListener('touchend', (e) => {
    if (document.body.classList.contains('has-expanded-clone')) return; // GATEKEEPER
    
    // ... (Keep your exact existing touchend momentum release math here) ...
    if (e.touches.length < 2) {
        initialPinchDistance = null;
    }
    
    if (e.touches.length === 0) {
        wasZooming = false; 
        
        if (isDragging) {
            isDragging = false;
            
            if (Date.now() - lastTouchTime > touchCancelTimer) {
                velocityX = 0;
            }
            
            if (Math.abs(velocityX) > touchMinFlickSpeed) {
                function applyTouchMomentum() {
                    if (isDragging) return; 
                    
                    targetTranslateX += velocityX * touchVelocityMultiplier; 
                    
                    const trackWidth = (maxYear - minYear) * pixelsPerYear;
                    const scaledWidth = trackWidth * targetScale;
                    const padding = window.innerWidth / 2;
                    const minX = -(scaledWidth - padding); 
                    const maxX = padding;
                    
                    targetTranslateX = Math.max(minX, Math.min(maxX, targetTranslateX));
                    translateX = targetTranslateX;
                    updateTransform();
                    
                    velocityX *= touchFriction; 
                    
                    if (Math.abs(velocityX) > touchStopThreshold) {
                        requestAnimationFrame(applyTouchMomentum);
                    }
                }
                requestAnimationFrame(applyTouchMomentum);
            }
        }
    } else if (e.touches.length === 1) {
        isDragging = false; 
    }
});

// --- 7. ZOOM LOGIC WITH BOUNDARIES ---
viewport.addEventListener('wheel', (e) => {
    e.preventDefault(); 


    const mouseX = e.clientX;
    const xs = (mouseX - targetTranslateX) / targetScale;

    // Use smaller increments for smoother wheel stepping
    const zoomAmount = e.deltaY > 0 ? 0.90 : 1.10; 
    targetScale *= zoomAmount;
    targetScale = Math.max(0.1, Math.min(targetScale, 4));

    targetTranslateX = mouseX - xs * targetScale;

    const trackWidth = (maxYear - minYear) * pixelsPerYear;
    const scaledWidth = trackWidth * targetScale;
    const padding = window.innerWidth / 2;

    const minX = -(scaledWidth - padding);
    const maxX = padding;

    targetTranslateX = Math.max(minX, Math.min(maxX, targetTranslateX));

    // Notice we REMOVED updateTransform() from here! The render loop handles it now.
}, { passive: false });

// --- 8. SMOOTH RENDER LOOP ---
function renderLoop() {
    const diffScale = targetScale - scale;
    const diffX = targetTranslateX - translateX;

    if (Math.abs(diffScale) > 0.0001 || Math.abs(diffX) > 0.01) {
        
        track.classList.add('is-moving'); 

        // THE FIX: Now using your easily adjustable glideSpeed variable!
        scale += diffScale * glideSpeed;
        translateX += diffX * glideSpeed;

        track.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        track.style.setProperty('--inv-scale', 1 / scale);
        
        updateVerticalStacking();
    } else {
        track.classList.remove('is-moving');
        scale = targetScale;
        translateX = targetTranslateX;
    }
    
    requestAnimationFrame(renderLoop);
}

renderLoop();

// --- KICK OFF APP ---
loadData();
updateTransform();

// Tap empty canvas to close active items on mobile
viewport.addEventListener('click', (e) => {
    if (!e.target.closest('.timeline-item') && !e.target.closest('.context-item')) {
        document.querySelectorAll('.timeline-item.is-active, .context-item.is-active, .context-item.is-open')
                .forEach(n => {
                    n.classList.remove('is-active');
                    n.classList.remove('is-open');
                });
    }
});