// ============================================
// INICIALIZAÇÃO DO MAPA
// ============================================
const map = L.map('map').setView([-30.08, -51.025], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// ============================================
// VARIÁVEIS GLOBAIS
// ============================================
const markers = [];
const latlngs = [];
let allStationsData = [];
let allTrips = [];
let currentVisualizationMode = 'both';
let markerClusterGroup = null;
let clusteringEnabled = true;
let polyline = null;
let selectedTripId = 'all';
let routeLayers = {};
let loadedRoutes = {};

// ============================================
// CONFIGURAÇÃO DE ROTAS GEOJSON - CORES DISTINTAS
// ============================================

const routeConfig = {
    'viagem-1': {
        file: 'rotas/linha_6IP.geojson',
        color: '#FF1744',      // Vermelho vibrante
        weight: 6,
        opacity: 0.85,
        name: 'Linha 6IP'
    },
    'viagem-2': {
        file: 'rotas/linha_1BCSOR.geojson',
        color: '#00E676',      // Verde neon
        weight: 6,
        opacity: 0.85,
        name: 'Linha 1BCSOR'
    },
    'viagem-3': {
        file: 'rotas/linha_3_5V.geojson',
        color: '#FFD600',      // Amarelo ouro
        weight: 6,
        opacity: 0.85,
        name: 'Linha 3 5V'
    },
    'viagem-4': {
        file: 'rotas/linha_4_12V.geojson',
        color: '#2979FF',      // Azul elétrico
        weight: 6,
        opacity: 0.85,
        name: 'Linha 4 12V'
    }
};

// ============================================
// FUNÇÕES DE PARSE
// ============================================

function parseNumber(val) {
    if (val === '-' || val === '' || val === undefined || val === null) return 0;
    const num = parseInt(val);
    return isNaN(num) ? 0 : num;
}

function parseLatLng(coordStr) {
    if (!coordStr) return null;
    const parts = coordStr.split(/[，,]/);
    if (parts.length !== 2) return null;
    
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    
    if (isNaN(lat) || isNaN(lng)) return null;
    return [lat, lng];
}

// ============================================
// CARREGAR ROTAS GEOJSON
// ============================================

function loadRoute(tripId) {
    return new Promise((resolve) => {
        if (loadedRoutes[tripId]) {
            resolve(loadedRoutes[tripId]);
            return;
        }
        
        const config = routeConfig[tripId];
        if (!config) {
            console.warn(`⚠️ Nenhuma configuração de rota para ${tripId}`);
            resolve(null);
            return;
        }
        
        fetch(config.file)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Arquivo ${config.file} não encontrado`);
                }
                return response.json();
            })
            .then(geojsonData => {
                console.log(`✅ Rota ${config.name} carregada`);
                loadedRoutes[tripId] = geojsonData;
                resolve(geojsonData);
            })
            .catch(error => {
                console.error(`❌ Erro ao carregar ${config.file}:`, error);
                resolve(null);
            });
    });
}

function displayRoute(tripId) {
    if (routeLayers[tripId]) {
        map.removeLayer(routeLayers[tripId]);
    }
    
    const config = routeConfig[tripId];
    if (!config) return;
    
    loadRoute(tripId).then(geojsonData => {
        if (!geojsonData) return;
        
        const layer = L.geoJSON(geojsonData, {
            style: {
                color: config.color,
                weight: config.weight,
                opacity: config.opacity,
                lineJoin: 'round',
                lineCap: 'round'
            }
        }).addTo(map);
        
        routeLayers[tripId] = layer;
        
        console.log(`🗺️ Rota ${config.name} exibida no mapa`);
    });
}

function clearAllRoutes() {
    Object.keys(routeLayers).forEach(tripId => {
        if (routeLayers[tripId]) {
            map.removeLayer(routeLayers[tripId]);
        }
    });
    routeLayers = {};
}

function displayAllRoutes() {
    allTrips.forEach(trip => {
        displayRoute(trip.id);
    });
}

// ============================================
// SISTEMA DE CORES ATUALIZADO
// ============================================

function getOccupancyColor(occupancy) {
    if (occupancy < 70) return '#4CAF50';
    if (occupancy < 100) return '#FF9800';
    return '#F44336';
}

function getMarkerColorByFlow(stationData, mode) {
    switch(mode) {
        case 'boarding':
            if (stationData.boarding === 0) return '#E0E0E0';
            if (stationData.boarding < 10) return '#90CAF9';
            if (stationData.boarding < 20) return '#42A5F5';
            return '#1565C0';
            
        case 'alighting':
            if (stationData.alighting === 0) return '#E0E0E0';
            if (stationData.alighting < 10) return '#F48FB1';
            if (stationData.alighting < 20) return '#EC407A';
            return '#C2185B';
            
        case 'both':
            const totalFlow = stationData.boarding + stationData.alighting;
            if (totalFlow === 0) return '#9E9E9E';
            
            const boardingRatio = stationData.boarding / totalFlow;
            if (boardingRatio > 0.6) return '#2196F3';
            if (boardingRatio < 0.4) return '#F44336';
            return '#9C27B0';
            
        case 'occupancy':
            return getOccupancyColor(stationData.occupancy);
            
        default:
            return '#9C27B0';
    }
}

function getMarkerSizeByFlow(stationData, mode) {
    let value;
    
    switch(mode) {
        case 'boarding':
            value = stationData.boarding;
            break;
        case 'alighting':
            value = stationData.alighting;
            break;
        case 'both':
            value = stationData.boarding + stationData.alighting;
            break;
        case 'occupancy':
            value = stationData.carried;
            break;
        default:
            value = stationData.boarding + stationData.alighting;
    }
    
    if (value === 0) return 5;
    if (value < 10) return 8;
    if (value < 20) return 11;
    if (value < 30) return 14;
    return 17;
}

// ============================================
// IDENTIFICAÇÃO DE VIAGENS POR BLOCOS DE HORÁRIO
// ============================================

function identifyTrips() {
    const tripBlocks = [
        {
            id: 'viagem-1',
            name: 'Viagem 1 - Linha 6IP',
            expectedLine: '6IP',
            startTime: '00:00:00',
            endTime: '07:59:59'
        },
        {
            id: 'viagem-2',
            name: 'Viagem 2 - Linha 1BCSOR',
            expectedLine: '1BCSOR',
            startTime: '08:00:00',
            endTime: '14:00:00'
        },
        {
            id: 'viagem-3',
            name: 'Viagem 3 - Linha 3 5V',
            expectedLine: '3 5V',
            startTime: '14:10:00',
            endTime: '15:59:59'
        },
        {
            id: 'viagem-4',
            name: 'Viagem 4 - Linha 4 12V',
            expectedLine: '4 12V',
            startTime: '16:00:00',
            endTime: '23:59:59'
        }
    ];
    
    const tripMap = new Map();
    
    tripBlocks.forEach(block => {
        tripMap.set(block.id, {
            id: block.id,
            name: block.name,
            line: block.expectedLine,
            startTime: block.startTime,
            endTime: block.endTime,
            stationIndices: [],
            stationCount: 0,
            totalBoarding: 0,
            totalAlighting: 0,
            driver: 'N/A',
            plate: 'N/A',
            direction: 'N/A',
            actualStartTime: null,
            actualEndTime: null
        });
    });
    
    allStationsData.forEach((station, index) => {
        const stationTime = station.time1.split(' ')[1];
        
        for (const block of tripBlocks) {
            if (stationTime >= block.startTime && stationTime <= block.endTime) {
                const trip = tripMap.get(block.id);
                
                if (trip.stationIndices.length === 0) {
                    trip.driver = station.driver;
                    trip.plate = station.plate;
                    trip.direction = station.direction;
                    trip.actualStartTime = station.time1;
                }
                
                trip.stationIndices.push(index);
                trip.stationCount++;
                trip.totalBoarding += station.boarding;
                trip.totalAlighting += station.alighting;
                trip.actualEndTime = station.time1;
                
                break;
            }
        }
    });
    
    allTrips = Array.from(tripMap.values()).filter(trip => trip.stationCount > 0);
    
    console.log(`🚌 ${allTrips.length} viagens identificadas por blocos de horário:`);
    allTrips.forEach(trip => {
        const inicio = trip.actualStartTime ? trip.actualStartTime.split(' ')[1].substring(0, 5) : 'N/A';
        const fim = trip.actualEndTime ? trip.actualEndTime.split(' ')[1].substring(0, 5) : 'N/A';
        console.log(`  ✅ ${trip.name}: ${inicio} → ${fim} (${trip.stationCount} estações, ${trip.totalBoarding} embarques)`);
    });
    
    return allTrips;
}

function populateTripFilter() {
    const select = document.getElementById('filter-trip');
    select.innerHTML = '<option value="all">📋 Todas as Viagens</option>';
    
    allTrips.forEach((trip) => {
        const option = document.createElement('option');
        option.value = trip.id;
        
        const inicio = trip.actualStartTime ? trip.actualStartTime.split(' ')[1].substring(0, 5) : 'N/A';
        const fim = trip.actualEndTime ? trip.actualEndTime.split(' ')[1].substring(0, 5) : 'N/A';
        
        option.textContent = `${trip.name} - ${inicio} → ${fim}`;
        select.appendChild(option);
    });
    
    console.log(`✅ Filtro de viagens populado com ${allTrips.length} opções`);
}

function applyTripFilter() {
    selectedTripId = document.getElementById('filter-trip').value;
    
    const summaryEl = document.getElementById('trip-summary');
    
    if (selectedTripId !== 'all') {
        const trip = allTrips.find(t => t.id === selectedTripId);
        if (trip) {
            // Mostrar resumo
            if (summaryEl) {
                summaryEl.style.display = 'block';
                
                const boardingEl = document.getElementById('summary-boarding');
                const alightingEl = document.getElementById('summary-alighting');
                const passengersEl = document.getElementById('summary-passengers');
                const stationsEl = document.getElementById('summary-stations');
                const plateEl = document.getElementById('summary-plate');
                const directionEl = document.getElementById('summary-direction');
                const periodEl = document.getElementById('summary-period');
                const avgEl = document.getElementById('summary-avg');
                
                if (boardingEl) boardingEl.textContent = trip.totalBoarding;
                if (alightingEl) alightingEl.textContent = trip.totalAlighting;
                if (passengersEl) passengersEl.textContent = trip.totalBoarding + trip.totalAlighting;
                if (stationsEl) stationsEl.textContent = trip.stationCount;
                if (plateEl) plateEl.textContent = trip.plate;
                if (directionEl) directionEl.textContent = trip.direction;
                
                if (periodEl && trip.actualStartTime && trip.actualEndTime) {
                    const inicio = trip.actualStartTime.split(' ')[1].substring(0, 5);
                    const fim = trip.actualEndTime.split(' ')[1].substring(0, 5);
                    periodEl.textContent = `${inicio} → ${fim}`;
                }
                
                if (avgEl && trip.stationCount > 0) {
                    const avg = Math.round((trip.totalBoarding + trip.totalAlighting) / trip.stationCount);
                    avgEl.textContent = avg;
                }
            }
            
            console.log(`🎯 Viagem selecionada: ${trip.name}`);
            
            clearAllRoutes();
            displayRoute(selectedTripId);
        }
    } else {
        if (summaryEl) {
            summaryEl.style.display = 'none';
        }
        console.log('📋 Mostrando todas as viagens');
        
        clearAllRoutes();
        displayAllRoutes();
    }
    
    updateVisualization(currentVisualizationMode);
}

function resetTripFilter() {
    selectedTripId = 'all';
    const selectEl = document.getElementById('filter-trip');
    if (selectEl) selectEl.value = 'all';
    
    const summaryEl = document.getElementById('trip-summary');
    if (summaryEl) {
        summaryEl.style.display = 'none';
    }
    
    console.log('🔄 Filtro de viagem resetado');
    
    clearAllRoutes();
    displayAllRoutes();
    
    updateVisualization(currentVisualizationMode);
}

function shouldShowStation(stationIndex) {
    if (selectedTripId === 'all') return true;
    
    const trip = allTrips.find(t => t.id === selectedTripId);
    if (!trip) return false;
    
    return trip.stationIndices.includes(stationIndex);
}

// ============================================
// FORMATAÇÃO
// ============================================

function formatDoorInfo(boarding, alighting) {
    const b = parseNumber(boarding);
    const a = parseNumber(alighting);
    
    if (b === 0 && a === 0) {
        return `<span style="color: #999;">Sem movimento</span>`;
    }
    return `<span style="color: #2196F3; font-weight: bold;">${b}</span> embarcaram | <span style="color: #F44336; font-weight: bold;">${a}</span> desembarcaram`;
}

function createPopupContent(data) {
    const occupancyStatus = data.occupancy >= 100 ? '⚠️ LOTADO' : 
                           data.occupancy >= 70 ? '⚠️ Moderado' : 
                           '✅ Confortável';
    
    return `
        <div class="popup-content">
            <div class="popup-header">
                <h3>🚏 Estação ${data.stationNumber}</h3>
                <p class="popup-coords">📍 ${data.latlng[0].toFixed(6)}, ${data.latlng[1].toFixed(6)}</p>
            </div>
            
            <div class="popup-flow">
                <div class="flow-card flow-boarding">
                    <div class="flow-number">${data.boarding}</div>
                    <div class="flow-label">↗️ EMBARCARAM</div>
                </div>
                <div class="flow-card flow-alighting">
                    <div class="flow-number">${data.alighting}</div>
                    <div class="flow-label">↘️ DESEMBARCARAM</div>
                </div>
            </div>
            
            <div class="popup-occupancy" style="background: ${getOccupancyColor(data.occupancy)};">
                <div class="occupancy-main">📊 ${data.carried} passageiros (${data.occupancy}%)</div>
                <div class="occupancy-status">${occupancyStatus}</div>
            </div>
            
            <div class="popup-section">
                <div class="popup-section-title">🚌 Informações do Veículo</div>
                <div class="popup-info-grid">
                    <div><b>Linha:</b> ${data.line}</div>
                    <div><b>Placa:</b> ${data.plate}</div>
                    <div><b>ID:</b> ${data.busId}</div>
                    <div style="grid-column: 1 / -1;"><b>Direção:</b> ${data.direction}</div>
                </div>
            </div>
            
            <div class="popup-section">
                <div class="popup-section-title">⏰ Horários</div>
                <div class="popup-time-info">
                    <div><b>Fluxo:</b> ${data.time1}</div>
                    <div><b>Recebido:</b> ${data.time2}</div>
                </div>
            </div>
            
            <details class="popup-details">
                <summary>🚪 Detalhes das Portas</summary>
                <div class="popup-doors">
                    ${data.doors.map((door, i) => {
                        const hasMovement = parseNumber(door.boarding) > 0 || parseNumber(door.alighting) > 0;
                        return `
                            <div class="door-item ${hasMovement ? 'door-active' : 'door-inactive'}">
                                <b>🚪 Porta ${i + 1}:</b> ${formatDoorInfo(door.boarding, door.alighting)}
                            </div>
                        `;
                    }).join('')}
                </div>
            </details>
            
            <button class="popup-close-btn" onclick="closeAllPopups()">✖ Fechar</button>
        </div>
    `;
}

function closeAllPopups() {
    markers.forEach(m => m.closePopup());
}

// ============================================
// CRIAR MARCADOR
// ============================================

function createInteractiveMarker(latlng, stationData, index) {
    const color = getMarkerColorByFlow(stationData, currentVisualizationMode);
    const size = getMarkerSizeByFlow(stationData, currentVisualizationMode);
    
    const marker = L.circleMarker(latlng, {
        color: color,
        fillColor: color,
        fillOpacity: 0.7,
        opacity: 1,
        radius: size,
        weight: 2,
        bubblingMouseEvents: true
    });
    
    const popupContent = createPopupContent(stationData);
    
    marker.bindPopup(popupContent, { 
        maxWidth: 500,
        minWidth: 480,
        maxHeight: 650,
        closeButton: true,
        autoClose: true,
        closeOnClick: false,
        autoPan: true,
        autoPanPadding: [50, 50],
        keepInView: true,
        className: 'custom-popup'
    });
    
    marker.on('mouseover', function(e) {
        this.setStyle({
            fillOpacity: 1,
            weight: 4,
            radius: size + 2
        });
        
        this.bindTooltip(`
            <div style="text-align: center; font-weight: bold;">
                🚏 Estação ${stationData.stationNumber}<br>
                <span style="color: #2196F3;">${stationData.boarding}↗️</span> | 
                <span style="color: #F44336;">${stationData.alighting}↘️</span>
            </div>
        `, {
            permanent: false,
            direction: 'top',
            offset: [0, -10],
            className: 'custom-tooltip'
        }).openTooltip();
    });
    
    marker.on('mouseout', function(e) {
        this.setStyle({
            fillOpacity: 0.7,
            weight: 2,
            radius: size
        });
        this.closeTooltip();
    });
    
    marker.on('click', function(e) {
        markers.forEach(m => {
            if (m !== marker) {
                m.closePopup();
            }
        });
        
        this.openPopup();
    });
    
    marker.stationData = stationData;
    marker.stationIndex = index;
    
    return marker;
}

// ============================================
// CLUSTERING
// ============================================

function initializeClusterGroup() {
    if (markerClusterGroup) {
        map.removeLayer(markerClusterGroup);
    }
    
    markerClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function(cluster) {
            const childCount = cluster.getChildCount();
            let className = 'marker-cluster-';
            
            if (childCount < 10) {
                className += 'small';
            } else if (childCount < 50) {
                className += 'medium';
            } else {
                className += 'large';
            }
            
            return L.divIcon({
                html: '<div><span>' + childCount + '</span></div>',
                className: 'marker-cluster ' + className,
                iconSize: L.point(40, 40)
            });
        }
    });
    
    map.addLayer(markerClusterGroup);
}

function toggleClustering(enabled) {
    clusteringEnabled = enabled;
    updateVisualization(currentVisualizationMode);
}

// ============================================
// FOCO POR ÍNDICE DO ARRAY
// ============================================

function focusStation(index) {
    const marker = markers[index];
    const station = allStationsData[index];
    
    if (!marker || !station) {
        console.error('❌ Índice inválido:', index);
        return;
    }
    
    markers.forEach(m => m.closePopup());
    
    console.log(`🎯 Focando no índice ${index} - Estação ${station.stationNumber}`);
    
    if (clusteringEnabled && markerClusterGroup) {
        const isVisible = markerClusterGroup.hasLayer(marker);
        
        if (isVisible) {
            markerClusterGroup.zoomToShowLayer(marker, function() {
                setTimeout(() => marker.openPopup(), 300);
            });
        } else {
            console.log('⚠️ Marcador não visível. Mudando para modo "both"...');
            const vizModeEl = document.getElementById('viz-mode');
            if (vizModeEl) vizModeEl.value = 'both';
            updateVisualization('both');
            
            setTimeout(() => {
                if (markerClusterGroup.hasLayer(marker)) {
                    markerClusterGroup.zoomToShowLayer(marker, function() {
                        setTimeout(() => marker.openPopup(), 300);
                    });
                }
            }, 500);
        }
    } else {
        map.setView(station.latlng, 18, {
            animate: true,
            duration: 1,
            easeLinearity: 0.5
        });
        setTimeout(() => marker.openPopup(), 600);
    }
}

// ============================================
// ESTATÍSTICAS AVANÇADAS
// ============================================

function updateAdvancedStatistics() {
    updateTopBoarding();
    updateTopAlighting();
    updateNoMovementStations();
}

function updateTopBoarding() {
    const container = document.getElementById('top-boarding-list');
    if (!container) return;
    
    const visibleStations = allStationsData
        .map((station, index) => ({ ...station, arrayIndex: index }))
        .filter((station, index) => shouldShowStation(index) && station.boarding > 0);
    
    const sortedByBoarding = visibleStations
        .sort((a, b) => b.boarding - a.boarding)
        .slice(0, 5);
    
    if (sortedByBoarding.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                Nenhum embarque
            </div>
        `;
        return;
    }
    
    let html = '';
    sortedByBoarding.forEach((station, idx) => {
        const position = idx + 1;
        const positionClass = position === 1 ? 'gold' : position === 2 ? 'silver' : position === 3 ? 'bronze' : 'default';
        
        html += `
            <div class="ranking-item" onclick="focusStation(${station.arrayIndex})">
                <div class="ranking-position ${positionClass}">${position}º</div>
                <div class="ranking-info">
                    <span class="ranking-station">🚏 Est. ${station.stationNumber}</span>
                    <span class="ranking-value">${station.alighting}↘️ | ${station.carried} a bordo</span>
                </div>
                <div class="ranking-badge">${station.boarding} ↗️</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function updateTopAlighting() {
    const container = document.getElementById('top-alighting-list');
    if (!container) return;
    
    const visibleStations = allStationsData
        .map((station, index) => ({ ...station, arrayIndex: index }))
        .filter((station, index) => shouldShowStation(index) && station.alighting > 0);
    
    const sortedByAlighting = visibleStations
        .sort((a, b) => b.alighting - a.alighting)
        .slice(0, 5);
    
    if (sortedByAlighting.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                Nenhum desembarque
            </div>
        `;
        return;
    }
    
    let html = '';
    sortedByAlighting.forEach((station, idx) => {
        const position = idx + 1;
        const positionClass = position === 1 ? 'gold' : position === 2 ? 'silver' : position === 3 ? 'bronze' : 'default';
        
        html += `
            <div class="ranking-item" onclick="focusStation(${station.arrayIndex})">
                <div class="ranking-position ${positionClass}">${position}º</div>
                <div class="ranking-info">
                    <span class="ranking-station">🚏 Est. ${station.stationNumber}</span>
                    <span class="ranking-value">${station.boarding}↗️ | ${station.carried} a bordo</span>
                </div>
                <div class="ranking-badge">${station.alighting} ↘️</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function updateNoMovementStations() {
    const container = document.getElementById('no-movement-list');
    if (!container) return;
    
    const visibleStations = allStationsData
        .map((station, index) => ({ ...station, arrayIndex: index }))
        .filter((station, index) => shouldShowStation(index));
    
    const noMovement = visibleStations.filter(station => station.boarding === 0 && station.alighting === 0);
    
    if (noMovement.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✅</div>
                Todas têm movimento
            </div>
        `;
        return;
    }
    
    let html = '';
    noMovement.forEach(station => {
        html += `
            <div class="no-movement-item" onclick="focusStation(${station.arrayIndex})">
                <strong>🚏 Est. ${station.stationNumber}</strong> - Sem movimento (${station.carried} a bordo)
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// ============================================
// ATUALIZAR VISUALIZAÇÃO COM FILTROS
// ============================================

function updateVisualization(mode) {
    console.log(`🎨 Visualização: ${mode}`);
    currentVisualizationMode = mode;
    
    markers.forEach(marker => map.removeLayer(marker));
    if (markerClusterGroup) markerClusterGroup.clearLayers();
    
    const visibleMarkers = [];
    
    markers.forEach((marker, index) => {
        const stationData = allStationsData[index];
        
        if (!shouldShowStation(index)) return;
        
        let show = true;
        if (mode === 'boarding' && stationData.boarding === 0) show = false;
        if (mode === 'alighting' && stationData.alighting === 0) show = false;
        
        if (show) {
            const color = getMarkerColorByFlow(stationData, mode);
            const size = getMarkerSizeByFlow(stationData, mode);
            
            marker.setStyle({
                color: color,
                fillColor: color,
                fillOpacity: 0.7,
                radius: size,
                weight: 2
            });
            
            visibleMarkers.push(marker);
        }
    });
    
    if (clusteringEnabled) {
        if (!markerClusterGroup) initializeClusterGroup();
        markerClusterGroup.addLayers(visibleMarkers);
    } else {
        visibleMarkers.forEach(marker => marker.addTo(map));
    }
    
    updateLegend(mode);
    createStationsList();
    updateAdvancedStatistics();
    
    const visibleCountEl = document.getElementById('visible-count');
    if (visibleCountEl) {
        visibleCountEl.textContent = visibleMarkers.length;
    }
    
    console.log(`✅ ${visibleMarkers.length} de ${markers.length} estações visíveis`);
}

function updateLegend(mode) {
    const legendContainer = document.getElementById('legend-container');
    if (!legendContainer) return;
    
    let legendHTML = '';
    
    switch(mode) {
        case 'both':
            legendHTML = `
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #2196F3;"></div>
                    <span>🟦 Mais Embarques</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #9C27B0;"></div>
                    <span>🟪 Equilibrado</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #F44336;"></div>
                    <span>🟥 Mais Desembarques</span>
                </div>
            `;
            break;
            
        case 'boarding':
            legendHTML = `
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #90CAF9;"></div>
                    <span>&lt; 10 embarques</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #42A5F5;"></div>
                    <span>10-20 embarques</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #1565C0;"></div>
                    <span>&gt; 20 embarques</span>
                </div>
            `;
            break;
            
        case 'alighting':
            legendHTML = `
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #F48FB1;"></div>
                    <span>&lt; 10 desembarques</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #EC407A;"></div>
                    <span>10-20 desembarques</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #C2185B;"></div>
                    <span>&gt; 20 desembarques</span>
                </div>
            `;
            break;
            
        case 'occupancy':
            legendHTML = `
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #4CAF50;"></div>
                    <span>&lt; 70% - Confortável</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #FF9800;"></div>
                    <span>70-100% - Moderado</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #F44336;"></div>
                    <span>&gt; 100% - Lotado</span>
                </div>
            `;
            break;
    }
    
    legendContainer.innerHTML = legendHTML;
}

// ============================================
// LISTA DE ESTAÇÕES
// ============================================

function createStationsList() {
    const listContainer = document.getElementById('stations-list');
    if (!listContainer) return;
    
    let listHTML = '';
    let count = 0;
    
    allStationsData.forEach((station, index) => {
        if (!shouldShowStation(index)) return;
        
        if (currentVisualizationMode === 'boarding' && station.boarding === 0) return;
        if (currentVisualizationMode === 'alighting' && station.alighting === 0) return;
        
        count++;
        
        listHTML += `
            <div class="station-list-item" onclick="focusStation(${index})">
                <b>🚏 Est. ${station.stationNumber}</b><br>
                <span style="color: #2196F3;">${station.boarding}↗️</span> | 
                <span style="color: #F44336;">${station.alighting}↘️</span> | 
                <span style="color: #666;">${station.carried} a bordo</span>
            </div>
        `;
    });
    
    if (count === 0) {
        listHTML = '<p style="text-align: center; color: #999; padding: 16px; font-size: 11px;">Nenhuma estação neste critério</p>';
    }
    
    listContainer.innerHTML = listHTML;
}

// ============================================
// CARREGAMENTO DO CSV
// ============================================

Papa.parse('data.csv', {
    download: true,
    header: false,
    skipEmptyLines: true,
    complete: function(results) {
        console.log('📄 CSV carregado!');
        
        const data = results.data.slice(2);
        
        let totalBoarding = 0;
        let totalAlighting = 0;
        let initialPassengers = 0;
        let firstStationIndex = -1;
        
        data.forEach((row, index) => {
            const latlng = parseLatLng(row[6]);
            if (!latlng) return;
            
            const boarding = parseNumber(row[9]);
            const alighting = parseNumber(row[10]);
            const carried = parseNumber(row[11]);
            const occupancy = parseNumber(row[12]);
            
            if (firstStationIndex === -1) {
                firstStationIndex = index;
                initialPassengers = carried;
            }
            
            const stationData = {
                line: row[0] || 'N/A',
                plate: row[1] || 'N/A',
                busId: row[2] || 'N/A',
                driver: row[3] || 'Não informado',
                direction: row[4] || 'N/A',
                stationNumber: row[5] || (index + 1),
                latlng: latlng,
                time1: row[7] || 'N/A',
                time2: row[8] || 'N/A',
                boarding: boarding,
                alighting: alighting,
                carried: carried,
                occupancy: occupancy,
                doors: [
                    { boarding: row[13], alighting: row[14] },
                    { boarding: row[15], alighting: row[16] },
                    { boarding: row[17], alighting: row[18] },
                    { boarding: row[19], alighting: row[20] },
                    { boarding: row[21], alighting: row[22] },
                    { boarding: row[23], alighting: row[24] }
                ]
            };
            
            allStationsData.push(stationData);
            
            totalBoarding += boarding;
            totalAlighting += alighting;
            
            const marker = createInteractiveMarker(latlng, stationData, allStationsData.length - 1);
            markers.push(marker);
            latlngs.push(latlng);
        });
        
        const totalPassengers = initialPassengers + totalBoarding;
        
        initializeClusterGroup();
        
        identifyTrips();
        populateTripFilter();
        displayAllRoutes();
        
        updateVisualization(currentVisualizationMode);
        
        const pointCountEl = document.getElementById('point-count');
        const totalBoardingEl = document.getElementById('total-boarding');
        const totalAlightingEl = document.getElementById('total-alighting');
        const totalPassengersEl = document.getElementById('total-passengers');
        const avgOccupancyEl = document.getElementById('avg-occupancy');
        
        if (pointCountEl) pointCountEl.textContent = markers.length;
        if (totalBoardingEl) totalBoardingEl.textContent = totalBoarding;
        if (totalAlightingEl) totalAlightingEl.textContent = totalAlighting;
        if (totalPassengersEl) totalPassengersEl.textContent = totalPassengers;
        if (avgOccupancyEl) avgOccupancyEl.textContent = markers.length > 0 ? Math.round(totalPassengers / markers.length) : 0;
        
        console.log(`✅ ${markers.length} estações carregadas!`);
        console.log(`📊 Passageiros iniciais: ${initialPassengers}`);
        console.log(`📊 Total embarques: ${totalBoarding}`);
        console.log(`📊 Total desembarques: ${totalAlighting}`);
        console.log(`📊 Total transportados: ${totalPassengers} (${initialPassengers} + ${totalBoarding})`);
    }
});