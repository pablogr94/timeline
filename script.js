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
const verticalOffsetStep = 20;    // Increased from 70 to peek out vertically
const horizontalOffsetStep = 20;   // Increased from 22 to fan out horizontally
const minScreenGap = 120;

// THE FIX: Change from const to let so we can temporarily slow it down
let glideSpeed = 0.4; 
const baseGlideSpeed = 0.4; // The snappy speed it will always return to

// --- MOBILE TOUCH CONSTANTS ---
const touchFriction = 0.95;         // 0.98 is very icy, 0.85 is heavy/sticky
const touchVelocityMultiplier = 25; // How forcefully a flick throws the canvas
const touchCancelTimer = 50;        // ms of finger resting before momentum is canceled
const touchMinFlickSpeed = 0.1;     // Minimum velocity to trigger momentum
const touchStopThreshold = 0.05;    // When the sliding animation goes to sleep

// --- INTERACTION STATE ---
const minZoomScale = 0.1;       // The furthest you can zoom out
const itemZoomMultiplier = 1;  // How aggressively images grow as you zoom in (0.4 = subtle, 1.0 = massive)

let targetScale = minZoomScale; // Where the zoom WANTS to be
let scale = targetScale;        // Where the zoom ACTUALLY is

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

// --- 2. DRAW TIMELINE GRID (Centuries & Decades Only) ---
function renderGridLines() {
    for (let year = minYear; year <= maxYear; year++) {
        
        // THE QUICK DISABLE: If the year doesn't end in 0, skip it entirely!
        // This stops thousands of DOM elements from being created.
        if (year % 10 !== 0) continue; 
        
        const xPos = (year - minYear) * pixelsPerYear;
        
        // Draw the line
        const line = document.createElement('div');
        line.style.left = `${xPos}px`;
        
        // Draw the year label
        const label = document.createElement('div');
        label.className = 'year-label';
        label.style.left = `${xPos}px`;
        label.innerText = year;
        
        // Apply classes
        if (year % 100 === 0) {
            line.className = 'century-line';
            label.style.fontWeight = '700'; 
        } else {
            line.className = 'decade-line';
        }
        
        track.appendChild(line);
        track.appendChild(label);
    }
}
// --- 3. RENDER ITEMS ---
function renderItems(items) {
    track.style.width = `${(maxYear - minYear) * pixelsPerYear}px`;
    items.forEach(item => {
        const xPos = (item.year - minYear) * pixelsPerYear;

        const el = document.createElement('div');
        el.className = 'timeline-item';
        
        item.baseX = xPos;
        item.priority = item.priority || 2; 
        el.style.left = `${xPos}px`;
        el.style.top = `0px`; 
        
      // 1. Build the image layer
      // 1. Build the image layer
      let html = '';
      if (item.image) {
          const fallbackSVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTI1Ij48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEyNSIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzdhN2E3YSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+";
          
          // THE FIX: Added onload handler so it snaps to the correct lane the moment it downloads
          // THE FIX: Now routes through our smart-sizing function on download
          html += `<img src="${item.image}" class="item-image" alt="${item.title}" onload="handleImageLoad(this)" onerror="this.onerror=null; this.src='${fallbackSVG}';">`;
          el.style.backgroundColor = 'transparent'; 
      }

        // 2. Build the info layer
        const hasDrawer = item.description || item.link || item.attribution;

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
                        
                        ${(item.link || item.attribution) ? `
                        <div class="wiki-link-container">
                            ${item.attribution ? `
                            <a href="${item.attributionLink || '#'}" target="_blank" class="attribution-link" onclick="event.stopPropagation();">
                                Photo by ${item.attribution}
                            </a>
                            ` : '<div></div>'}
                            
                            ${item.link ? `
                            <a href="${item.link}" target="_blank" class="wiki-link" onclick="event.stopPropagation();">
                                <span>Wikipedia</span>
                                <svg class="wiki-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M7 17L17 7"></path>
                                    <path d="M7 7h10v10"></path>
                                </svg>
                            </a>
                            ` : ''}
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
        const maxHeight = window.innerHeight * 0.80; 

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
        const infoHeader = clone.querySelector('.info-header'); // Grab the whole header
        
        if (descToggle && infoHeader) {
            descToggle.innerHTML = `
                <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
            `;
            
            // THE FIX: Listen for taps on the ENTIRE header row, not just the arrow
            infoHeader.addEventListener('click', (toggleEvent) => {
                toggleEvent.stopPropagation(); 
                
                // Toggle the open class and save the state (true/false)
                const isOpen = clone.classList.toggle('desc-open');
                
                // THE FIX: Dynamic Centering
                const descBox = clone.querySelector('.info-desc-box');
                if (descBox) {
                    // Measure exactly how tall the text drawer is right now
                    const descHeight = descBox.offsetHeight;
                    
                    if (isOpen) {
                        // Push the entire image UP by half the drawer's height
                        clone.style.top = `${targetTop - (descHeight / 2)}px`;
                    } else {
                        // Send it perfectly back to the center
                        clone.style.top = `${targetTop}px`;
                    }
                }
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
        
        // THE FIX: Safe Click Logic with Smart Camera Panning
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            
            const wasOpen = el.classList.contains('is-open');
            
            // Close any other open context cards first
            document.querySelectorAll('.context-item.is-open').forEach(openItem => {
                openItem.classList.remove('is-open');
            });
            
            // If it wasn't already open, open it and check the camera bounds
            if (!wasOpen) {
                el.classList.add('is-open');
                
                // Wait 10ms for the CSS visibility to apply so we can measure its true screen coordinates
                setTimeout(() => {
                    const card = el.querySelector('.context-card');
                    if (!card) return;
                    
                    const rect = card.getBoundingClientRect();
                    const screenPadding = 30; // Gives a nice 30px breathing room from the edge of the glass
                    
                    let panOffset = 0;
                    
                    // Check if it bleeds off the right edge
                    if (rect.right > window.innerWidth - screenPadding) {
                        panOffset = rect.right - (window.innerWidth - screenPadding);
                        targetTranslateX -= panOffset; // Move camera right = shift track left
                    } 
                    // Check if it bleeds off the left edge (rare, but good safety)
                    else if (rect.left < screenPadding) {
                        panOffset = screenPadding - rect.left;
                        targetTranslateX += panOffset; // Move camera left = shift track right
                    }
                    
                    // If we needed to pan, ensure we don't accidentally pan past the end of the timeline
                    if (panOffset !== 0) {
                        // THE FIX: Drop the engine into a buttery slow speed just for this movement!
                        glideSpeed = 0.05;
                        
                        const trackWidth = (maxYear - minYear) * pixelsPerYear;
                        const scaledWidth = trackWidth * targetScale;
                        const paddingLimit = window.innerWidth / 2;
                        
                        const minX = -(scaledWidth - paddingLimit); 
                        const maxX = paddingLimit;
                        
                        targetTranslateX = Math.max(minX, Math.min(maxX, targetTranslateX));
                    }
                }, 10);
            }
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

// --- 4. DETERMINISTIC LANE STACKING & SMOOTH FADE ---
function updateVerticalStacking() {
    if (!loadedItems.length) return;

    const dynamicVerticalStep = verticalOffsetStep * Math.max(0.7, Math.min(1.1, scale));
    const priorityBoostFactor = Math.max(0, 1 - (scale - 0.3) / 1.2);
    
    // THE MAGIC FADE: As you zoom in past 0.1, the lane heights smoothly collapse to 0
    // By scale 0.5, all cards will have naturally settled back onto the center line!
    const verticalFade = Math.max(0, Math.min(1, 1 - (scale - 0.1) / 0.4)); 

    // THE FIX: Remove the .sort() entirely. Use the perfectly sorted array from loadData()
    const sortedItems = loadedItems; 
    
    const placedCards = [];
    const gapBuffer = 20;
    
    // We use a fixed scale (0.05) to check collisions. 
    // This makes the math immune to zooming, permanently eliminating all stuttering!
    const fixedCollisionScale = 0.05; 

    sortedItems.forEach((item, index) => {
        item.globalIndex = index;
        
        const isMajorMilestone = Number(item.priority) === 1;
        item.priorityScale = isMajorMilestone ? 1 + (0.35 * priorityBoostFactor) : 1;
        
        const baseWidth = item.element.offsetWidth || 150;
        
        // 1. Calculate boundaries in a static, zoom-independent space
        const staticX = (item.year - minYear) * pixelsPerYear * fixedCollisionScale;
        const staticWidth = baseWidth * (isMajorMilestone ? 1.35 : 1);
        const staticLeft = staticX - (staticWidth / 2);
        const staticRight = staticX + (staticWidth / 2);

        // 2. Find the lowest available deterministic lane
        let laneIndex = 0;
        let foundLane = false;
        
        while (!foundLane) {
            const assignedOffset = laneIndex === 0 ? 0 : Math.ceil(laneIndex / 2) * (laneIndex % 2 === 1 ? -1 : 1);
            
            const hasCollision = placedCards.some(p => {
                return p.laneOffset === assignedOffset &&
                       (staticLeft < p.staticRight + gapBuffer) &&
                       (staticRight > p.staticLeft - gapBuffer);
            });

            if (!hasCollision) {
                foundLane = true;
                item.laneOffset = assignedOffset;
                placedCards.push({ staticLeft, staticRight, laneOffset: assignedOffset });
            } else {
                laneIndex++;
            }
        }
        
        // 3. Count identical years to prevent overlap when fully zoomed in
        let sameYearCount = 0;
        for (let i = 0; i < index; i++) {
            if (sortedItems[i].year === item.year) sameYearCount++;
        }

        // 4. Calculate final positions
        let yOffset = item.laneOffset * dynamicVerticalStep * verticalFade;
        let xOffset = 0;

        if (sameYearCount > 0) {
            // THE FIX: Fan out VERTICALLY (one above, one below) when they share the exact same year
            const yMultiplier = Math.ceil(sameYearCount / 2);
            const yDirection = sameYearCount % 2 === 1 ? -1 : 1;
            
            // We use a large vertical step (200px) so the images completely clear each other.
            // The Math.max(0, 1 - verticalFade) ensures this separation organically kicks in as you zoom in!
            const verticalStep = 200 * Math.max(0, 1 - verticalFade); 
            
            // Apply the large vertical spread on top of any existing lane math
            yOffset += yMultiplier * yDirection * verticalStep;
            
            // Remove the horizontal fanning entirely. 
            // This guarantees both items stay perfectly anchored to their true year line!
            xOffset = 0; 
        }

        // 5. Apply styles
        item.element.style.setProperty('--priority-scale', item.priorityScale);
        item.element.style.left = `calc(${item.baseX}px + (${xOffset}px * var(--inv-scale, 1)))`;
        item.element.style.top = `calc(${yOffset}px * var(--inv-scale, 1))`;
        
        // Locked Z-Index strictly by chronology to permanently stop z-fighting
        const baseZ = isMajorMilestone ? 500 : 10;
        item.element.style.zIndex = baseZ + item.globalIndex;
    });
}
// --- 5. UPDATE SCREEN ---
function updateTransform() {
    track.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    track.style.setProperty('--inv-scale', 1 / scale);

    // THE FIX: Starts growing gently the exact moment you zoom in from 0.02.
    // The 0.6 determines the intensity. Lower it to 0.4 for less growth, or raise to 0.8 for more.
    // Change it in both functions to this:
    track.style.setProperty('--item-zoom', 1 + (scale - minZoomScale) * itemZoomMultiplier);
    // THE FIX: Changed / 0.2 to / 0.1 so it ramps up to full opacity twice as fast
    track.style.setProperty('--detail-opacity', Math.max(0, Math.min(1, (scale - 0.1) / 0.1)));
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
        let currentClientX = e.touches[0].clientX;
        let newX = currentClientX - startX;
        
        let currentTime = Date.now();
        let dt = currentTime - lastTouchTime;
        let deltaX = currentClientX - lastTouchXPos;
        
        // THE FIX: Velocity Armor
        // 1. Only process velocity if at least 10ms have passed (kills 1ms sub-frame explosions)
        if (dt > 10) {
            let instantVelocity = deltaX / dt;
            
            // 2. Hard cap the maximum possible velocity so a bad finger roll can't throw the map
            instantVelocity = Math.max(-3, Math.min(3, instantVelocity));
            
            // 3. Smooth the velocity by blending it with the previous frame's momentum
            velocityX = (velocityX * 0.6) + (instantVelocity * 0.4);
            
            lastTouchXPos = currentClientX;
            lastTouchTime = currentTime;
        }
        
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
        newScale = Math.max(minZoomScale, Math.min(newScale, 1.5)); 
        
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
        isDragging = true; 
        wasZooming = false; 
        
        // THE FIX: Sync the target coordinates to the CURRENT visual coordinates.
        // This instantly aborts any leftover zoom gliding so the timeline doesn't snap!
        targetTranslateX = translateX;
        targetScale = scale;
        
        startX = e.touches[0].clientX - targetTranslateX;
        lastTouchXPos = e.touches[0].clientX;
        lastTouchTime = Date.now();
        velocityX = 0;
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
    targetScale = Math.max(minZoomScale, Math.min(targetScale, 1.5));

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

        // THE FIX: Gracefully slides the glideSpeed back up to 0.4 if it was lowered
        glideSpeed += (baseGlideSpeed - glideSpeed) * 0.1;

        scale += diffScale * glideSpeed;
        translateX += diffX * glideSpeed;

        track.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        track.style.setProperty('--inv-scale', 1 / scale);
       // THE FIX: Changed / 0.2 to / 0.1 so it ramps up to full opacity twice as fast
        track.style.setProperty('--detail-opacity', Math.max(0, Math.min(1, (scale - 0.1) / 0.1)));
        
        // THE FIX: Starts growing gently the exact moment you zoom in from 0.02.
        // The 0.6 determines the intensity. Lower it to 0.4 for less growth, or raise to 0.8 for more.
        // Change it in both functions to this:
        track.style.setProperty('--item-zoom', 1 + (scale - minZoomScale) * itemZoomMultiplier);

        updateVerticalStacking();
    } else {
        track.classList.remove('is-moving');
        scale = targetScale;
        translateX = targetTranslateX;
    }
    
    requestAnimationFrame(renderLoop);
}

// --- 9. SMART IMAGE SIZING ---
window.handleImageLoad = function(img) {
    const aspect = img.naturalWidth / img.naturalHeight;
    
    // The target: Image width should never be less than 70% of its base height
    const minAspect = 0.70; 
    
    if (aspect > 0 && aspect < minAspect) {
        // Calculate how much we need to multiply the height by to reach the minimum width
        const boost = minAspect / aspect;
        img.closest('.timeline-item').style.setProperty('--aspect-boost', boost);
    }
    
    // Proceed with assigning the lane now that the true size is known
    updateVerticalStacking();
};

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