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
            return true;
        case 'boarding':
            return stationData.boarding > 0;
        case 'alighting':
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
// FOCO POR ÍNDICE DO ARRAY (COORDENADAS)
// ============================================

function focusStation(index) {
    const marker = markers[index];
    const station = allStationsData[index];
    
    if (!marker || !station) {
        console.error('❌ Índice inválido:', index);
        return;
    }
    
    markers.forEach(m => m.closePopup());
    
    console.log(`🎯 Focando no índice ${index} - Estação ${station.stationNumber} [${station.latlng[0]}, ${station.latlng[1]}]`);
    
    if (clusteringEnabled && markerClusterGroup) {
        const isVisible = markerClusterGroup.hasLayer(marker);
        
        if (isVisible) {
            markerClusterGroup.zoomToShowLayer(marker, function() {
                setTimeout(() => marker.openPopup(), 300);
            });
        } else {
            console.log('⚠️ Marcador não visível. Mudando para "Taxa de Ocupação"...');
            document.getElementById('viz-mode').value = 'occupancy';
            updateVisualization('occupancy');
            
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
    
    const sortedByBoarding = allStationsData
        .map((station, index) => ({ ...station, arrayIndex: index }))
        .filter(station => station.boarding > 0)
        .sort((a, b) => b.boarding - a.boarding)
        .slice(0, 5);
    
    if (sortedByBoarding.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                Nenhum embarque registrado
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
                    <span class="ranking-station">🚏 Estação ${station.stationNumber}</span>
                    <span class="ranking-value">${station.alighting}↘️ | ${station.carried} a bordo</span>
                </div>
                <div class="ranking-badge">${station.boarding} ↗️</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    console.log(`📊 Top 5 Embarques atualizado`);
}

function updateTopAlighting() {
    const container = document.getElementById('top-alighting-list');
    if (!container) return;
    
    const sortedByAlighting = allStationsData
        .map((station, index) => ({ ...station, arrayIndex: index }))
        .filter(station => station.alighting > 0)
        .sort((a, b) => b.alighting - a.alighting)
        .slice(0, 5);
    
    if (sortedByAlighting.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                Nenhum desembarque registrado
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
                    <span class="ranking-station">🚏 Estação ${station.stationNumber}</span>
                    <span class="ranking-value">${station.boarding}↗️ | ${station.carried} a bordo</span>
                </div>
                <div class="ranking-badge">${station.alighting} ↘️</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    console.log(`📊 Top 5 Desembarques atualizado`);
}

function updateNoMovementStations() {
    const container = document.getElementById('no-movement-list');
    if (!container) return;
    
    const noMovement = allStationsData
        .map((station, index) => ({ ...station, arrayIndex: index }))
        .filter(station => station.boarding === 0 && station.alighting === 0);
    
    if (noMovement.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✅</div>
                Todas as estações têm movimento
            </div>
        `;
        return;
    }
    
    let html = '';
    noMovement.forEach(station => {
        html += `
            <div class="no-movement-item" onclick="focusStation(${station.arrayIndex})">
                <strong>🚏 Estação ${station.stationNumber}</strong> - Sem movimento (${station.carried} a bordo)
            </div>
        `;
    });
    
    container.innerHTML = html;
    console.log(`📊 Estações sem movimento: ${noMovement.length}`);
}

// ============================================
// ATUALIZAR VISUALIZAÇÃO
// ============================================

function updateVisualization(mode) {
    console.log(`🎨 Visualização: ${mode}`);
    currentVisualizationMode = mode;
    
    markers.forEach(marker => map.removeLayer(marker));
    if (markerClusterGroup) markerClusterGroup.clearLayers();
    if (polyline) {
        map.removeLayer(polyline);
        polyline = null;
    }
    
    const visibleMarkers = [];
    const visibleCoords = [];
    
    markers.forEach((marker, index) => {
        const stationData = allStationsData[index];
        
        if (shouldShowMarker(stationData, mode)) {
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
    
    if (clusteringEnabled) {
        if (!markerClusterGroup) initializeClusterGroup();
        markerClusterGroup.addLayers(visibleMarkers);
    } else {
        visibleMarkers.forEach(marker => marker.addTo(map));
    }
    
    if (visibleCoords.length > 1) {
        polyline = L.polyline(visibleCoords, {
            color: '#1E90FF',
            weight: 3,
            opacity: 0.7
        }).addTo(map);
    }
    
    updateLegend(mode);
    createStationsList();
    updateAdvancedStatistics();
    
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
    
    let listHTML = '';
    let count = 0;
    
    allStationsData.forEach((station, index) => {
        if (!shouldShowMarker(station, currentVisualizationMode)) return;
        
        count++;
        
        listHTML += `
            <div class="station-list-item" onclick="focusStation(${index})">
                <b>🚏 Estação ${station.stationNumber}</b><br>
                <span style="color: #2196F3;">${station.boarding}↗️</span> | 
                <span style="color: #F44336;">${station.alighting}↘️</span> | 
                <span style="color: #666;">${station.carried} a bordo</span>
            </div>
        `;
    });
    
    if (count === 0) {
        listHTML = '<p style="text-align: center; color: #999; padding: 20px; font-size: 13px;">Nenhuma estação neste critério</p>';
    }
    
    listContainer.innerHTML = listHTML;
}

// ============================================
// CARREGAMENTO DO CSV - CÁLCULO CORRETO
// ============================================

// ============================================
// CARREGAMENTO DO CSV - CÁLCULO CORRETO DEFINITIVO
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
            
            // Capturar passageiros iniciais da PRIMEIRA estação válida (valor direto de carried)
            if (firstStationIndex === -1) {
                firstStationIndex = index;
                initialPassengers = carried; // Passageiros que estavam no início
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
        
        // CÁLCULO CORRETO: Todos os passageiros únicos que usaram o ônibus
        // Se ônibus começou vazio: total = embarques
        // Se ônibus começou com passageiros: total = inicial + embarques
        const totalPassengers = initialPassengers + totalBoarding;
        
        initializeClusterGroup();
        updateVisualization(currentVisualizationMode);
        
        document.getElementById('point-count').textContent = markers.length;
        document.getElementById('total-boarding').textContent = totalBoarding;
        document.getElementById('total-alighting').textContent = totalAlighting;
        document.getElementById('total-passengers').textContent = totalPassengers;
        document.getElementById('avg-occupancy').textContent = markers.length > 0 ? Math.round(totalPassengers / markers.length) : 0;
        
        console.log(`✅ ${markers.length} estações carregadas!`);
        console.log(`📊 Passageiros iniciais (já no ônibus): ${initialPassengers}`);
        console.log(`📊 Total de embarques: ${totalBoarding}`);
        console.log(`📊 Total de desembarques: ${totalAlighting}`);
        console.log(`📊 Total passageiros transportados: ${totalPassengers} (${initialPassengers} + ${totalBoarding})`);
        console.log(`📊 Média por estação: ${markers.length > 0 ? Math.round(totalPassengers / markers.length) : 0}`);
    }
});