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
        html += `
            <div class="item-info">
                <div class="info-header">
                    <div class="info-meta">
                        <div class="info-year">${item.year}</div>
                        <div class="info-title">${item.title}</div>
                    </div>
                    ${item.description ? `<div class="info-toggle">+ info</div>` : ''}
                    <div class="close-btn">&times;</div>
                </div>
                
                ${item.description ? `
                <div class="desc-mask">
                    <div class="info-desc-box">${item.description}</div>
                </div>
                ` : ''}
                
            </div>
        `;
        
        el.innerHTML = html;
        
      // 3. Smart Click Logic (Viewport-Protected Morph)
      el.addEventListener('click', (e) => {
        const isTouchDevice = window.matchMedia("(hover: none)").matches;

        if (!isTouchDevice) {
            // DESKTOP: Native 1-click behavior
            if (item.link) window.open(item.link, '_blank');
            return;
        }

        // MOBILE: Clone Teleport Logic
        if (document.querySelector('.mobile-clone')) return; 

        // 1. Measure original card position
        const rect = el.getBoundingClientRect();

        // 2. Create clone
        const clone = el.cloneNode(true);
        clone.className = 'timeline-item mobile-clone'; 

        // 3. Measure expanded height IN-BOUNDS to prevent mobile 'vh' recalculation shifts
        clone.style.transition = 'none';
        clone.style.position = 'fixed';
        clone.style.top = '0';
        clone.style.left = '0';
        clone.style.width = '100vw';
        clone.style.height = 'auto';
        clone.style.visibility = 'hidden';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);

        const expandedHeight = clone.offsetHeight;
        const expandedTop = (window.innerHeight - expandedHeight) / 2;

        // 4. Snap clone directly over original card
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;

        // Hide original card on timeline
        el.style.opacity = '0';

        // 5. Force layout commit
        clone.offsetHeight; 

        // 6. Restore visibility & animate outward
        clone.style.visibility = 'visible';
        clone.style.pointerEvents = 'auto';
        clone.style.transition = ''; 
        clone.classList.add('is-expanded');
        clone.style.left = '0px';
        clone.style.top = `${expandedTop}px`;
        clone.style.width = '100vw';
        clone.style.height = `${expandedHeight}px`;

        // CLOSE LOGIC
        clone.querySelector('.close-btn').addEventListener('click', (btnEvent) => {
            btnEvent.stopPropagation();
            
            const liveRect = el.getBoundingClientRect();
            
            clone.classList.remove('is-expanded');
            clone.style.left = `${liveRect.left}px`;
            clone.style.top = `${liveRect.top}px`;
            clone.style.width = `${liveRect.width}px`;
            clone.style.height = `${liveRect.height}px`;
            
            setTimeout(() => {
                el.style.opacity = '1';
                clone.remove();
            }, 400); 
        });

        // SECOND-TAP LOGIC (Open Link)
        clone.addEventListener('click', (cloneEvent) => {
            if (!cloneEvent.target.classList.contains('close-btn') && item.link) {
                window.open(item.link, '_blank');
            }
        });
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
        // THE FIX: Adds a specific class if it is a single moment in time
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

        const descHTML = (item.description || item.image) 
            ? `<div class="context-card">
                 ${imgHTML}
                 <div class="card-title">${item.title}</div>
                 <div class="card-year">${dateText}</div>
                 ${item.description ? `<div class="card-desc">${item.description}</div>` : ''}
               </div>`
            : '';

        // 3. Build Visual Graphics (Dot vs Line+Dots)
        const visualHTML = isPointEvent 
            ? `<div class="context-circle"></div>` // Just one dot for point events
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
        
        if (item.link) {
            const titleEl = el.querySelector('.context-title');
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                window.open(item.link, '_blank');
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
    isDragging = true;
    startX = e.clientX - targetTranslateX;
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
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
    
    // Instantly snap both target and actual coordinates so dragging feels snappy!
    targetTranslateX = newX;
    translateX = targetTranslateX; 
    
    updateTransform();
});

window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mouseleave', () => isDragging = false);


// --- MOBILE TOUCH LOGIC (PAN & ZOOM) ---
// Pan State
let lastTouchTime = 0;
let lastTouchXPos = 0;
let velocityX = 0;
let wasZooming = false; // THE FIX: Prevents pan snapping after a zoom

// Zoom State
let initialPinchDistance = null;
let initialScale = 1;

viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        // Only allow a new pan if we aren't lingering from a previous zoom
        if (!wasZooming) {
            isDragging = true;
            startX = e.touches[0].clientX - targetTranslateX;
            
            lastTouchXPos = e.touches[0].clientX;
            lastTouchTime = Date.now();
            velocityX = 0;
        }
    } else if (e.touches.length === 2) {
        // 2-FINGER PINCH INITIATION
        isDragging = false; 
        wasZooming = true; // Lock panning
        
        initialPinchDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = targetScale;
    }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isDragging) {
        // --- 1-FINGER PANNING ---
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
        // --- 2-FINGER ZOOMING ---
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
    if (e.touches.length < 2) {
        initialPinchDistance = null;
    }
    
    if (e.touches.length === 0) {
        // THE FIX: Unlock panning only when all fingers leave the glass
        wasZooming = false; 
        
        if (isDragging) {
            // --- MOMENTUM RELEASE ---
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
        // THE FIX: Do nothing. Let the 1 remaining finger rest harmlessly 
        // while the render loop finishes its smooth glide.
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
        document.querySelectorAll('.timeline-item.is-active, .context-item.is-active')
                .forEach(n => n.classList.remove('is-active'));
    }
});