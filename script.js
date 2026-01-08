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
let currentVisualizationMode = 'occupancy';
let markerClusterGroup = null;
let clusteringEnabled = true;
let polyline = null;

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
// SISTEMA DE CORES
// ============================================

function getOccupancyColor(occupancy) {
    if (occupancy < 70) return '#4CAF50';
    if (occupancy < 100) return '#FF9800';
    return '#F44336';
}

function getBoardingColor(boarding) {
    if (boarding < 10) return '#90CAF9';
    if (boarding < 20) return '#42A5F5';
    return '#1565C0';
}

function getAlightingColor(alighting) {
    if (alighting < 10) return '#F48FB1';
    if (alighting < 20) return '#EC407A';
    return '#C2185B';
}

function getMarkerColor(stationData, mode) {
    switch(mode) {
        case 'occupancy':
            return getOccupancyColor(stationData.occupancy);
        case 'boarding':
            return getBoardingColor(stationData.boarding);
        case 'alighting':
            return getAlightingColor(stationData.alighting);
        default:
            return getOccupancyColor(stationData.occupancy);
    }
}

function getMarkerSize(boarding, alighting) {
    const flow = boarding + alighting;
    if (flow < 10) return 7;
    if (flow < 20) return 9;
    return 11;
}

// ============================================
// FILTRO AUTOMÁTICO POR VISUALIZAÇÃO
// ============================================

function shouldShowMarker(stationData, mode) {
    switch(mode) {
        case 'occupancy':
            // Mostra TODOS
            return true;
            
        case 'boarding':
            // Mostra APENAS com embarques
            return stationData.boarding > 0;
            
        case 'alighting':
            // Mostra APENAS com desembarques
            return stationData.alighting > 0;
            
        default:
            return true;
    }
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
                    <div><b>Motorista:</b> ${data.driver}</div>
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
    const color = getMarkerColor(stationData, currentVisualizationMode);
    const size = getMarkerSize(stationData.boarding, stationData.alighting);
    
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
        maxWidth: 400,
        minWidth: 300,
        maxHeight: 500,
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
// ATUALIZAR VISUALIZAÇÃO (COM FILTRO AUTOMÁTICO)
// ============================================

function updateVisualization(mode) {
    console.log(`🎨 Visualização: ${mode}`);
    currentVisualizationMode = mode;
    
    // Remover todos os marcadores
    markers.forEach(marker => map.removeLayer(marker));
    if (markerClusterGroup) markerClusterGroup.clearLayers();
    if (polyline) {
        map.removeLayer(polyline);
        polyline = null;
    }
    
    // Filtrar e atualizar marcadores
    const visibleMarkers = [];
    const visibleCoords = [];
    
    markers.forEach((marker, index) => {
        const stationData = allStationsData[index];
        
        // FILTRO AUTOMÁTICO: só mostra se passar no critério
        if (shouldShowMarker(stationData, mode)) {
            // Atualizar cor
            const color = getMarkerColor(stationData, mode);
            const size = getMarkerSize(stationData.boarding, stationData.alighting);
            
            marker.setStyle({
                color: color,
                fillColor: color,
                fillOpacity: 0.7,
                radius: size,
                weight: 2
            });
            
            visibleMarkers.push(marker);
            visibleCoords.push(stationData.latlng);
        }
    });
    
    // Adicionar ao mapa
    if (clusteringEnabled) {
        if (!markerClusterGroup) initializeClusterGroup();
        markerClusterGroup.addLayers(visibleMarkers);
    } else {
        visibleMarkers.forEach(marker => marker.addTo(map));
    }
    
    // Linha do trajeto
    if (visibleCoords.length > 1) {
        polyline = L.polyline(visibleCoords, {
            color: '#1E90FF',
            weight: 3,
            opacity: 0.7
        }).addTo(map);
    }
    
    // Atualizar legenda e lista
    updateLegend(mode);
    createStationsList();
    
    // Atualizar contador
    document.getElementById('visible-count').textContent = visibleMarkers.length;
    
    console.log(`✅ ${visibleMarkers.length} de ${markers.length} estações visíveis`);
}

function updateLegend(mode) {
    const legendContainer = document.getElementById('legend-container');
    
    let legendHTML = '';
    
    switch(mode) {
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
    }
    
    legendContainer.innerHTML = legendHTML;
}

// ============================================
// LISTA DE ESTAÇÕES
// ============================================

function createStationsList() {
    const listContainer = document.getElementById('stations-list');
    if (!listContainer) return;
    
    let listHTML = '<div style="max-height: 300px; overflow-y: auto; font-size: 12px;">';
    
    let count = 0;
    allStationsData.forEach((station, index) => {
        if (!shouldShowMarker(station, currentVisualizationMode)) return;
        
        count++;
        const color = getMarkerColor(station, currentVisualizationMode);
        
        listHTML += `
            <div class="station-list-item" onclick="focusStation(${index})" style="
                padding: 8px;
                margin: 5px 0;
                background: white;
                border-left: 4px solid ${color};
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
            " onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background='white'">
                <b>🚏 Estação ${station.stationNumber}</b><br>
                <span style="color: #2196F3;">${station.boarding}↗️</span> | 
                <span style="color: #F44336;">${station.alighting}↘️</span> | 
                <span style="color: #666;">${station.carried} a bordo</span>
            </div>
        `;
    });
    
    if (count === 0) {
        listHTML += '<p style="text-align: center; color: #999; padding: 20px;">Nenhuma estação neste critério</p>';
    }
    
    listHTML += '</div>';
    listContainer.innerHTML = listHTML;
}

function focusStation(index) {
    const marker = markers[index];
    const station = allStationsData[index];
    
    markers.forEach(m => m.closePopup());
    
    if (clusteringEnabled && markerClusterGroup) {
        markerClusterGroup.zoomToShowLayer(marker, function() {
            marker.openPopup();
        });
    } else {
        map.setView(station.latlng, 17, {
            animate: true,
            duration: 0.8
        });
        
        setTimeout(() => {
            marker.openPopup();
        }, 500);
    }
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
        let totalPassengers = 0;
        
        data.forEach((row, index) => {
            const latlng = parseLatLng(row[6]);
            if (!latlng) return;
            
            const boarding = parseNumber(row[9]);
            const alighting = parseNumber(row[10]);
            const carried = parseNumber(row[11]);
            const occupancy = parseNumber(row[12]);
            
            const stationData = {
                line: row[0] || 'N/A',
                plate: row[1] || 'N/A',
                busId: row[2] || 'N/A',
                driver: row[3] || 'Não informado',
                direction: row[4] || 'N/A',
                stationNumber: row[5] || index + 1,
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
            totalPassengers += carried;
            
            const marker = createInteractiveMarker(latlng, stationData, allStationsData.length - 1);
            markers.push(marker);
            latlngs.push(latlng);
        });
        
        initializeClusterGroup();
        updateVisualization(currentVisualizationMode);
        
        document.getElementById('point-count').textContent = markers.length;
        document.getElementById('total-boarding').textContent = totalBoarding;
        document.getElementById('total-alighting').textContent = totalAlighting;
        document.getElementById('avg-occupancy').textContent = Math.round(totalPassengers / markers.length);
        
        console.log(`✅ ${markers.length} estações carregadas!`);
    }
});