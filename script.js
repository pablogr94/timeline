// --- TIMELINE CONSTANTS ---
const minYear = 1800;
const maxYear = 2100;
const pixelsPerYear = 100; 

// Base overlap steps at 1x zoom
const verticalOffsetStep = 100;    // Increased from 70 to peek out vertically
const horizontalOffsetStep = 45;   // Increased from 22 to fan out horizontally
const minScreenGap = 160;

// --- INTERACTION STATE ---
let scale = 1;
let translateX = -3000; 
let translateY = 0;
let isDragging = false;
let startX, startY;
let loadedItems = []; 
let zoomTimeout; // NEW: Timer to track when scrolling stops

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

        // 2. Build the info layer (only includes description if it exists in JSON)
        const descHTML = item.description ? `<div class="info-desc">${item.description}</div>` : '';
        html += `
            <div class="item-info">
                <div class="info-year">${item.year}</div>
                <div class="info-title">${item.title}</div>
                ${descHTML}
            </div>
        `;
        
        el.innerHTML = html;
        
        // 3. Add Click-to-Open logic
        if (item.link) {
            el.addEventListener('click', () => {
                window.open(item.link, '_blank');
            });
        }
        
        track.appendChild(el);
        item.element = el;
    });

    updateTransform();
}

// --- RENDER CONTEXTS (Masonry Stacking + Popover + Click Links) ---
function renderContexts(contexts) {
    let worldEventLanes = [];  // Tracks occupied space in the world events track
    let culturalEraLanes = []; // Tracks occupied space in the cultural eras track
    
    // Sort chronologically so they stack predictably left-to-right
    contexts.sort((a, b) => a.start - b.start);

    contexts.forEach(item => {
        const startX = (item.start - minYear) * pixelsPerYear;
        const width = (item.end - item.start) * pixelsPerYear;
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
        el.className = 'context-item';
        el.style.left = `${startX}px`;
        el.style.width = `${width}px`;
        
        const laneOffset = assignedLane * 45; 
        el.style.top = `calc(${isWorldEvent ? -laneOffset : laneOffset}px * var(--inv-scale, 1))`;

        // 1. Build optional Card Image HTML
        const imgHTML = item.image 
            ? `<img src="${item.image}" class="card-image" alt="${item.title}">` 
            : '';

        // 2. Build Card Popover HTML (only if image or description exists)
        const descHTML = (item.description || item.image) 
            ? `<div class="context-card">
                 ${imgHTML}
                 <div class="card-title">${item.title}</div>
                 <div class="card-year">${item.start} — ${item.end}</div>
                 ${item.description ? `<div class="card-desc">${item.description}</div>` : ''}
               </div>`
            : '';

        // 3. Inject into the DOM
        el.innerHTML = `
            <div class="context-line"></div>
            <div class="context-dot start"></div>
            <div class="context-dot end"></div>
            <div class="context-title">
                <span class="title-text">${item.title}</span>
                <span class="title-year">${item.start} - ${item.end}</span>
                ${descHTML}
            </div>
        `;
        
        // 4. Click to open Wikipedia / Link in a new tab!
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
    loadedItems.forEach(item => {
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
        let clusterFade = 1; // Tracks the fade for the whole deck of cards

        cluster.forEach((item, count) => {
            let yOffset = 0;
            let xOffset = 0;
            
            // Initialize tracker for the first item
            if (count === 0) item.sameYearIndex = 0;
            
            if (count > 0) {
                const prevItem = cluster[count - 1];
                const dist = item.screenX - prevItem.screenX;

                // NEW FIX: Track if it shares the EXACT year for horizontal fanning
                item.sameYearIndex = (item.year === prevItem.year) ? prevItem.sameYearIndex + 1 : 0;

                // Cards begin to unstack when they exceed 40% of the breaking gap
                const solidGap = dynamicMinGap * 0.4;
                
                let localFade = 1;
                if (dist > solidGap) {
                    localFade = 1 - ((dist - solidGap) / (dynamicMinGap - solidGap));
                    localFade = Math.max(0, Math.min(1, localFade));
                }
                
                // Cascade the fade: outer cards flatten out if inner cards do
                clusterFade = Math.min(clusterFade, localFade);

                // VERTICAL: Always stack so cards don't hide each other
                const yMultiplier = Math.ceil(count / 2);
                const yDirection = count % 2 === 1 ? -1 : 1;
                yOffset = yMultiplier * yDirection * dynamicVerticalStep * clusterFade;
                
                // HORIZONTAL: Only fan out if they share the exact same year!
                if (item.sameYearIndex > 0) {
                    const xMultiplier = Math.ceil(item.sameYearIndex / 2);
                    const xDirection = item.sameYearIndex % 2 === 1 ? -1 : 1;
                    xOffset = xMultiplier * xDirection * dynamicHorizontalStep * clusterFade;
                }
            }

            // PRIORITY MAGIC: Boost scale for Priority 1 items
            const isMajorMilestone = Number(item.priority) === 1;
            const itemPriorityScale = isMajorMilestone ? 1 + (0.35 * priorityBoostFactor) : 1;
            item.element.style.setProperty('--priority-scale', itemPriorityScale);
            
            // Apply scale-aware positions
            item.element.style.left = `calc(${item.baseX}px + (${xOffset}px * var(--inv-scale, 1)))`;
            item.element.style.top = `calc(${yOffset}px * var(--inv-scale, 1))`;
            
            // Major milestones always sit on top of the pile
            const baseZ = isMajorMilestone ? 50 : 10;
            item.element.style.zIndex = baseZ + count;
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
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    let targetX = e.clientX - startX;
    
    const trackWidth = (maxYear - minYear) * pixelsPerYear;
    const scaledWidth = trackWidth * scale;
    const padding = window.innerWidth / 2;
    
    const minX = -(scaledWidth - padding); 
    const maxX = padding;                  
    
    if (targetX > maxX) {
        targetX = maxX;
        startX = e.clientX - targetX; 
    } else if (targetX < minX) {
        targetX = minX;
        startX = e.clientX - targetX; 
    }
    
    translateX = targetX;
    translateY = 0; 
    
    updateTransform();
});

window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mouseleave', () => isDragging = false);

// --- 7. ZOOM LOGIC WITH BOUNDARIES ---
viewport.addEventListener('wheel', (e) => {
    e.preventDefault(); 

    // --- NEW: DISABLE TRANSITIONS WHILE SCROLLING ---
    track.classList.add('is-zooming');
    
    // Clear the timer if you keep scrolling
    clearTimeout(zoomTimeout);
    
    // Set a timer to re-enable transitions 150ms after your last scroll tick
    zoomTimeout = setTimeout(() => {
        track.classList.remove('is-zooming');
    }, 150);
    // ------------------------------------------------

    const mouseX = e.clientX;
    const xs = (mouseX - translateX) / scale;

    const zoomAmount = e.deltaY > 0 ? 0.85 : 1.15;
    scale *= zoomAmount;
    scale = Math.max(0.1, Math.min(scale, 4));

    translateX = mouseX - xs * scale;

    const trackWidth = (maxYear - minYear) * pixelsPerYear;
    const scaledWidth = trackWidth * scale;
    const padding = window.innerWidth / 2;

    const minX = -(scaledWidth - padding);
    const maxX = padding;

    translateX = Math.max(minX, Math.min(maxX, translateX));

    updateTransform();
}, { passive: false });

// --- KICK OFF APP ---
loadData();