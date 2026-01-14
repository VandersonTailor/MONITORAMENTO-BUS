// 
// INICIALIZAÇÃO DO MAPA
// 
const map = L.map('map').setView([-30.08, -51.025], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// 
// VARIÁVEIS GLOBAIS
// 
const markers = [];
const latlngs = [];
let allStationsData = [];
let allTrips = [];
let currentVisualizationMode = 'both';
let markerClusterGroup = null;
let clusteringEnabled = false;
let polyline = null;
let selectedTripId = 'all';
let routeLayers = {};
let loadedRoutes = {};

// 
// MAPEAMENTO COMPLETO DE TIPOS DE TARIFA
// 
const tariffTypes = {
    '23': { name: 'Divisa', value: 5.00, color: '#FFD600', icon: '🟡' },
    '01': { name: 'Máxima', value: 10.30, color: '#FF1744', icon: '🔴' },
    '03': { name: 'Figueira', value: 7.70, color: '#4CAF50', icon: '🟢' },
    '04': { name: 'Mínima', value: 4.80, color: '#00E676', icon: '🟢' },
    '98': { name: 'Isento', value: 0.00, color: '#9E9E9E', icon: '⚪' }
};

// 
// DADOS DE MOVIMENTAÇÃO (EXTRAÍDOS DA IMAGEM)
// 
const tariffMovementData = {
    'viagem-1': {
        '23': { cash: 0, card: 0 },
        '01': { cash: 6, card: 38 },
        '03': { cash: 5, card: 4 },
        '04': { cash: 6, card: 7 },
        '98': { cash: 0, card: 11 }
    },
    'viagem-2': {
        '23': { cash: 1, card: 0 },
        '01': { cash: 3, card: 9 },
        '03': { cash: 0, card: 0 },
        '04': { cash: 10, card: 19 },
        '98': { cash: 0, card: 33 }
    },
    'viagem-3': {
        '23': { cash: 0, card: 0 },
        '01': { cash: 1, card: 9 },
        '03': { cash: 4, card: 7 },
        '04': { cash: 14, card: 20 },
        '98': { cash: 0, card: 27 }
    },
    'viagem-4': {
        '23': { cash: 3, card: 1 },
        '01': { cash: 6, card: 21 },
        '03': { cash: 11, card: 8 },
        '04': { cash: 5, card: 14 },
        '98': { cash: 0, card: 6 }
    }
};

// Variáveis globais para filtros
let selectedTariffTypes = Object.keys(tariffTypes);
let selectedPaymentMethods = ['cash', 'card'];
let tariffMetrics = {};
let paymentMetrics = {};

// 
// CONFIGURAÇÃO DE ROTAS GEOJSON
// 
const routeConfig = {
    'viagem-1': {
        file: 'rotas/linha_6IP.geojson',
        color: '#FF1744',
        weight: 6,
        opacity: 0.85,
        name: 'Linha 6IP (IDA) ➡️'
    },
    'viagem-2': {
        file: 'rotas/linha_1BCSOR.geojson',
        color: '#00E676',
        weight: 6,
        opacity: 0.85,
        name: 'Linha 1BCSOR (VOLTA) ⬅️'
    },
    'viagem-3': {
        file: 'rotas/linha_3_5V.geojson',
        color: '#FFD600',
        weight: 6,
        opacity: 0.85,
        name: 'Linha 3 5V (IDA) ➡️'
    },
    'viagem-4': {
        file: 'rotas/linha_4_12V.geojson',
        color: '#2979FF',
        weight: 6,
        opacity: 0.85,
        name: 'Linha 4 12V (VOLTA) ⬅️'
    }
};

// 
// FUNÇÕES DE PARSE
// 
function parseNumber(val) {
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

// 
// FUNÇÕES DE TARIFA E PAGAMENTO
// 
function getTariffType(tariffCode) {
    if (!tariffCode) return null;
    const code = String(tariffCode).trim();
    return tariffTypes[code] ? code : null;
}

function getTariffInfo(tariffCode) {
    const code = getTariffType(tariffCode);
    if (!code) return { name: 'Desconhecido', value: 0, color: '#CCC', icon: '⚫' };
    return tariffTypes[code];
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

// 
// CARREGAR ROTAS GEOJSON
// 
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
                if (!response.ok) throw new Error(`Arquivo ${config.file} não encontrado`);
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

// 
// SISTEMA DE CORES
// 
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

// 
// IDENTIFICAÇÃO DE VIAGENS
// 
const referencePoints = {
    // Coordenadas reais extraídas do teu CSV (conforme log do console)
    'parada-31-ida': { lat: -30.078786, lng: -51.116670 },
    'parada-31-volta': { lat:   -30.079075, lng: -51.116130 },
    'parada-42-ida': { lat: -30.094485, lng: -51.079701 },
    'parada-42-volta': { lat: -30.094761, lng: -51.080683 }
      
};

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

function determineDirection(stationLat, stationLng, stationNumber) {
    // ✅ LOG: Ver qual número de estação está sendo verificado
    const numStation = parseInt(stationNumber);
    
    if (numStation !== 31) return null;
    
    console.log(`🔍 Verificando Parada 31: Est.${stationNumber} nas coords [${stationLat}, ${stationLng}]`);
    
    const distIda = calculateDistance(
        stationLat, stationLng,
        referencePoints['parada-31-ida'].lat,
        referencePoints['parada-31-ida'].lng
    );
    
    const distVolta = calculateDistance(
        stationLat, stationLng,
        referencePoints['parada-31-volta'].lat,
        referencePoints['parada-31-volta'].lng
    );
    
    console.log(`   📏 Distância IDA: ${distIda.toFixed(2)}m`);
    console.log(`   📏 Distância VOLTA: ${distVolta.toFixed(2)}m`);
    
    const tolerance = 50;
    
    if (distIda < tolerance) {
        console.log(`   ✅ PARADA 31 IDA ENCONTRADA! (${distIda.toFixed(2)}m)`);
        return 'ida';
    }
    if (distVolta < tolerance) {
        console.log(`   ✅ PARADA 31 VOLTA ENCONTRADA! (${distVolta.toFixed(2)}m)`);
        return 'volta';
    }
    
    console.warn(`   ⚠️ Parada 31 fora da tolerância (IDA: ${distIda.toFixed(2)}m, VOLTA: ${distVolta.toFixed(2)}m)`);
    return null;
}

// ✅ NOVA FUNÇÃO: Identificar Parada 42
function determineStation42(stationLat, stationLng, stationNumber) {
    const numStation = parseInt(stationNumber);
    
    if (numStation !== 42) return false;
    
    console.log(`🔍 Verificando Parada 42: Est.${stationNumber} nas coords [${stationLat}, ${stationLng}]`);
    
    const distVolta = calculateDistance(
        stationLat, stationLng,
        referencePoints['parada-42-volta'].lat,
        referencePoints['parada-42-volta'].lng
    );
    
    console.log(`   📏 Distância da P42 de referência: ${distVolta.toFixed(2)}m`);
    
    const tolerance = 50; // 50 metros de tolerância
    
    if (distVolta < tolerance) {
        console.log(`   ✅ PARADA 42 VOLTA ENCONTRADA! (${distVolta.toFixed(2)}m)`);
        return true;
    }
    
    console.warn(`   ⚠️ Parada 42 fora da tolerância (${distVolta.toFixed(2)}m)`);
    return false;
}

// ✅ NOVA FUNÇÃO: Identificar Parada 42
function determineStation42(stationLat, stationLng, stationNumber) {
    if (parseInt(stationNumber) !== 42) return false;
    
    const distVolta = calculateDistance(
        stationLat, stationLng,
        referencePoints['parada-42-volta'].lat,
        referencePoints['parada-42-volta'].lng
    );
    
    const tolerance = 50; // 50 metros de tolerância
    
    return distVolta < tolerance;
}

function identifyTrips() {
    const tripBlocks = [
        {
            id: 'viagem-1',
            name: 'Viagem 1 - Linha 6IP (IDA)',
            expectedLine: '6IP',
            direction: 'ida',
            startTime: '00:00:00',
            endTime: '07:59:59'
        },
        {
            id: 'viagem-2',
            name: 'Viagem 2 - Linha 1BCSOR (VOLTA)',
            expectedLine: '1BCSOR',
            direction: 'volta',
            startTime: '08:00:00',
            endTime: '14:00:00'
        },
        {
            id: 'viagem-3',
            name: 'Viagem 3 - Linha 3 5V (IDA)',
            expectedLine: '3 5V',
            direction: 'ida',
            startTime: '14:00:00',
            endTime: '15:59:59'
        },
        {
            id: 'viagem-4',
            name: 'Viagem 4 - Linha 4 12V (VOLTA)',
            expectedLine: '4 12V',
            direction: 'volta',
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
            direction: block.direction,
            startTime: block.startTime,
            endTime: block.endTime,
            stationIndices: [],
            stationCount: 0,
            totalBoarding: 0,
            totalAlighting: 0,
            driver: 'N/A',
            plate: 'N/A',
            directionName: 'N/A',
            actualStartTime: null,
            actualEndTime: null
        });
    });
    
    allStationsData.forEach((station, index) => {
        const stationTime = station.time1.split(' ')[1];
        const stationLat = station.latlng[0];
        const stationLng = station.latlng[1];
        
        const geoDirection = determineDirection(stationLat, stationLng, station.stationNumber);
        
        for (const block of tripBlocks) {
            if (stationTime >= block.startTime && stationTime <= block.endTime) {
                if (geoDirection && geoDirection !== block.direction) {
                    console.warn(`⚠️ Estação ${station.stationNumber} no horário da ${block.name}, mas coordenadas indicam ${geoDirection.toUpperCase()}`);
                    continue;
                }
                
                const trip = tripMap.get(block.id);
                
                if (trip.stationIndices.length === 0) {
                    trip.driver = station.driver;
                    trip.plate = station.plate;
                    trip.directionName = station.direction;
                    trip.actualStartTime = station.time1;
                }
                
                trip.stationIndices.push(index);
                trip.stationCount++;
                trip.totalBoarding += station.boarding;
                trip.totalAlighting += station.alighting;
                trip.actualEndTime = station.time1;
                
                if (geoDirection) {
                    console.log(`✅ Estação ${station.stationNumber} → ${block.name} (confirmado por coordenadas)`);
                }
                
                break;
            }
        }
    });
    
    allTrips = Array.from(tripMap.values()).filter(trip => trip.stationCount > 0);
    
    console.log(`🚌 ${allTrips.length} viagens identificadas:`);
    allTrips.forEach(trip => {
        const inicio = trip.actualStartTime ? trip.actualStartTime.split(' ')[1].substring(0, 5) : 'N/A';
        const fim = trip.actualEndTime ? trip.actualEndTime.split(' ')[1].substring(0, 5) : 'N/A';
        const direction = trip.direction === 'ida' ? '➡️ IDA' : '⬅️ VOLTA';
        console.log(`  ✅ ${trip.name} ${direction}: ${inicio} → ${fim} (${trip.stationCount} estações)`);
    });
    
    // ✅ IDENTIFICAR ESTAÇÕES NÃO ATRIBUÍDAS
    const assignedIndices = new Set();
    allTrips.forEach(trip => {
        trip.stationIndices.forEach(idx => assignedIndices.add(idx));
    });

    const unassignedStations = [];
    allStationsData.forEach((station, index) => {
        if (!assignedIndices.has(index)) {
            unassignedStations.push({
                index: index,
                stationNumber: station.stationNumber,
                time: station.time1,
                boarding: station.boarding,
                alighting: station.alighting
            });
        }
    });

    if (unassignedStations.length > 0) {
        console.warn(`⚠️ ${unassignedStations.length} estações NÃO foram atribuídas a nenhuma viagem:`);
        unassignedStations.forEach(s => {
            console.warn(`   Est. ${s.stationNumber} às ${s.time} - ${s.boarding}↗️ ${s.alighting}↘️`);
        });
    }
    
    return allTrips;
}
function updateMetricsPanel(metrics) {
    console.log('📊 Atualizando painel de métricas com:', metrics);

    // 🟢 Mínima (Dentro do Município)
    const minimaEl = document.getElementById('metric-minima-ida');
    if (minimaEl) {
        const valor = metrics.minima || 0;
        minimaEl.textContent = valor;
        console.log(`   🟢 Mínima: ${valor}`);
    }

    // 🔴 Máxima (De Município para outro)
    const maximaEl = document.getElementById('metric-maxima');
    if (maximaEl) {
        const valor = metrics.maxima || 0;
        maximaEl.textContent = valor;
        console.log(`   🔴 Máxima: ${valor}`);
    }

    // 🟡 Divisa (Dentro de Porto Alegre)
    const divisaEl = document.getElementById('metric-divisa');
    if (divisaEl) {
        const valor = metrics.divisa || 0;
        divisaEl.textContent = valor;
        console.log(`   🟡 Divisa: ${valor}`);
    }

    // 🟢 Figueira (Embarques P42→P31)
    const figueiraEl = document.getElementById('metric-figueiraIda');
    if (figueiraEl) {
        const valor = metrics.figueira || 0;
        figueiraEl.textContent = valor;
        console.log(`   🟢 Figueira: ${valor}`);
    }

    // ⚪ Isentos
    const isentosEl = document.getElementById('metric-isentos');
    if (isentosEl) {
        isentosEl.textContent = metrics.isentos || 0;
        console.log(`   ⚪ Isentos: ${metrics.isentos}`);
    }

    console.log('✅ Painel de métricas atualizado');
}
// 
// MÉTRICAS DAS PARADAS 31 E 42 (BUSCA POR COORDENADAS)
// 
function calculateMetrics() {
    const metrics = {
        minima: 0,
        maxima: 0,
        divisa: 0,
        figueira: 0,
        isentos: 0
    };

    console.log('📊 ==========================================');
    console.log('📊 CALCULANDO TARIFAS POR ROTA');
    console.log('📊 ==========================================');

    // Processar cada viagem
    allTrips.forEach(trip => {
        let p31Index = -1;
        let p42Index = -1;

        const p31Ref = trip.direction === 'ida'
            ? referencePoints['parada-31-ida']
            : referencePoints['parada-31-volta'];

        const p42Ref = trip.direction === 'ida'
            ? referencePoints['parada-42-ida']
            : referencePoints['parada-42-volta'];

        // Localizar P31 e P42
        trip.stationIndices.forEach((stationIndex, idx) => {
            const st = allStationsData[stationIndex];

            const dist31 = calculateDistance(
                st.latlng[0], st.latlng[1],
                p31Ref.lat, p31Ref.lng
            );

            if (dist31 < 50 && p31Index === -1) {
                p31Index = idx;
            }

            const dist42 = calculateDistance(
                st.latlng[0], st.latlng[1],
                p42Ref.lat, p42Ref.lng
            );

            if (dist42 < 50 && p42Index === -1) {
                p42Index = idx;
            }
        });

        if (p31Index === -1) {
            console.warn(`⚠️ P31 não encontrada na ${trip.name}`);
            return;
        }

        // Calcular isentos desta viagem
        let isentosViagem = 0;
        trip.stationIndices.forEach(idx => {
            isentosViagem += allStationsData[idx].door1Alighting || 0;
        });
        
        // ✅ Somar isentos desta viagem ao total
        metrics.isentos += isentosViagem;

        // Calcular total de embarques da viagem
        let totalEmbarquesViagem = 0;
        trip.stationIndices.forEach(idx => {
            totalEmbarquesViagem += allStationsData[idx].boarding || 0;
        });

        /* ===============================
           🔴 IDA
        =============================== */
        if (trip.direction === 'ida') {
            let embarquesAteP31 = 0;
            let desembAteP31 = 0;
            let isentosAteP31 = 0;
            
            for (let i = 0; i <= p31Index; i++) {
                const st = allStationsData[trip.stationIndices[i]];
                embarquesAteP31 += st.boarding || 0;
                desembAteP31 += st.alighting || 0;
                isentosAteP31 += st.door1Alighting || 0;
            }
            
            // Calcular isentos DEPOIS de P31
            let isentosDepoisP31 = isentosViagem - isentosAteP31;
            
            // 1. Mínima (subtrai isentos até P31)
            const minimaIda = desembAteP31 - isentosAteP31;
            metrics.minima += minimaIda;

            // 2. Figueira
            let figueira = 0;
            if (p42Index !== -1 && p42Index < p31Index) {
                for (let i = p42Index + 1; i <= p31Index; i++) {
                    figueira += allStationsData[trip.stationIndices[i]].boarding || 0;
                }
            }
            metrics.figueira += figueira;

            // 3. Divisa
            let divisaIda = 0;
            for (let i = p31Index + 1; i < trip.stationIndices.length; i++) {
                divisaIda += allStationsData[trip.stationIndices[i]].boarding || 0;
            }
            metrics.divisa += divisaIda;

            // 4. ✅ Máxima (subtrai isentos até P31 E isentos depois P31)
            const maximaIda = embarquesAteP31 - figueira - minimaIda - isentosAteP31 - isentosDepoisP31;
            metrics.maxima += maximaIda;

            console.log(`📊 ${trip.name} (${totalEmbarquesViagem} embarques):`);
            console.log(`   Até P31: ${embarquesAteP31} emb, ${desembAteP31} desemb`);
            console.log(`   🟢 Mínima (desemb - isentos): ${desembAteP31} - ${isentosAteP31} = ${minimaIda}`);
            console.log(`   🟡 Figueira (emb P42→P31): ${figueira}`);
            console.log(`   🔵 Divisa (emb depois P31): ${divisaIda}`);
            console.log(`   ⚪ Isentos: ${isentosViagem} (${isentosAteP31} até P31 + ${isentosDepoisP31} depois)`);
            console.log(`   🔴 Máxima: ${embarquesAteP31} - ${figueira} - ${minimaIda} - ${isentosAteP31} - ${isentosDepoisP31} = ${maximaIda}`);
            console.log(`   ✅ Verificação: ${maximaIda} + ${figueira} + ${minimaIda} + ${divisaIda} + ${isentosViagem} = ${maximaIda + figueira + minimaIda + divisaIda + isentosViagem} (esperado: ${totalEmbarquesViagem})`);
        }

        /* ===============================
           🔵 VOLTA
        =============================== */
        if (trip.direction === 'volta') {
            let embarquesAteP31 = 0;
            let desembAteP31 = 0;
            let isentosAteP31 = 0;
            
            for (let i = 0; i <= p31Index; i++) {
                const st = allStationsData[trip.stationIndices[i]];
                embarquesAteP31 += st.boarding || 0;
                desembAteP31 += st.alighting || 0;
                isentosAteP31 += st.door1Alighting || 0;
            }
            
            // Calcular isentos DEPOIS de P31
            let isentosDepoisP31 = 0;
            for (let i = p31Index + 1; i < trip.stationIndices.length; i++) {
                isentosDepoisP31 += allStationsData[trip.stationIndices[i]].door1Alighting || 0;
            }
            
            // 1. Divisa (subtrai isentos até P31)
            const divisaVolta = desembAteP31 - isentosAteP31;
            metrics.divisa += divisaVolta;

            // 2. Mínima (subtrai isentos depois P31)
            let embarquesDepoisP31 = 0;
            for (let i = p31Index + 1; i < trip.stationIndices.length; i++) {
                embarquesDepoisP31 += allStationsData[trip.stationIndices[i]].boarding || 0;
            }
            const minimaVolta = embarquesDepoisP31 - isentosDepoisP31;
            metrics.minima += minimaVolta;

            // 3. Máxima (NÃO subtrai isentos - eles já foram subtraídos na Divisa)
            const maximaVolta = embarquesAteP31 - desembAteP31;
            metrics.maxima += maximaVolta;

            console.log(`📊 ${trip.name} (${totalEmbarquesViagem} embarques):`);
            console.log(`   Até P31: ${embarquesAteP31} emb, ${desembAteP31} desemb`);
            console.log(`   🟡 Divisa (desemb - isentos): ${desembAteP31} - ${isentosAteP31} = ${divisaVolta}`);
            console.log(`   🟢 Mínima: ${embarquesDepoisP31} emb - ${isentosDepoisP31} isentos = ${minimaVolta}`);
            console.log(`   🔴 Máxima: ${embarquesAteP31} - ${desembAteP31} = ${maximaVolta}`);
            console.log(`   ⚪ Isentos: ${isentosViagem} (${isentosAteP31} até P31 + ${isentosDepoisP31} depois)`);
            console.log(`   ✅ Verificação: ${maximaVolta} + ${divisaVolta} + ${minimaVolta} + ${isentosViagem} = ${maximaVolta + divisaVolta + minimaVolta + isentosViagem} (esperado: ${totalEmbarquesViagem})`);
        }
    });

    console.log('📊 ==========================================');
    console.log('📊 TARIFAS FINAIS:');
    console.log('📊 ==========================================');
    console.log(`   🔴 Máxima: ${metrics.maxima}`);
    console.log(`   🟡 Figueira: ${metrics.figueira}`);
    console.log(`   🔵 Divisa: ${metrics.divisa}`);
    console.log(`   🟢 Mínima: ${metrics.minima}`);
    console.log(`   ⚪ Isentos: ${metrics.isentos}`);
    console.log(`   ──────────────────────`);
    console.log(`   ✅ SOMA TOTAL: ${metrics.maxima + metrics.figueira + metrics.divisa + metrics.minima + metrics.isentos}`);
    console.log('📊 ==========================================');

    updateMetricsPanel(metrics);

    return metrics;
}

function calculateTripMetrics(tripId) {
    const trip = allTrips.find(t => t.id === tripId);
    if (!trip) return null;

    const metrics = {
        maxima: 0,
        figueira: 0,
        minima: 0,
        divisa: 0,
        isentos: 0
    };

    let p31Index = -1;
    let p42Index = -1;

    const p31Ref = trip.direction === 'ida'
        ? referencePoints['parada-31-ida']
        : referencePoints['parada-31-volta'];

    const p42Ref = trip.direction === 'ida'
        ? referencePoints['parada-42-ida']
        : referencePoints['parada-42-volta'];

    // Localizar P31 e P42
    trip.stationIndices.forEach((stationIndex, idx) => {
        const station = allStationsData[stationIndex];

        const distP31 = calculateDistance(
            station.latlng[0], station.latlng[1],
            p31Ref.lat, p31Ref.lng
        );

        if (distP31 < 50 && p31Index === -1) {
            p31Index = idx;
        }

        const distP42 = calculateDistance(
            station.latlng[0], station.latlng[1],
            p42Ref.lat, p42Ref.lng
        );

        if (distP42 < 50 && p42Index === -1) {
            p42Index = idx;
        }
    });

    if (p31Index === -1) {
        console.warn(`⚠️ [FILTRO] P31 NÃO encontrada na ${trip.name}`);
        return metrics;
    }

    // ✅ Calcular isentos TOTAIS desta viagem
    let isentosViagem = 0;
    trip.stationIndices.forEach(idx => {
        isentosViagem += allStationsData[idx].door1Alighting || 0;
    });

    // Total de embarques da viagem
    let totalEmbarquesViagem = 0;
    trip.stationIndices.forEach(idx => {
        totalEmbarquesViagem += allStationsData[idx].boarding || 0;
    });

    /* ===============================
       🔴 IDA
    =============================== */
    if (trip.direction === 'ida') {
        let embarquesAteP31 = 0;
        let desembAteP31 = 0;
        let isentosAteP31 = 0;
        
        for (let i = 0; i <= p31Index; i++) {
            const st = allStationsData[trip.stationIndices[i]];
            embarquesAteP31 += st.boarding || 0;
            desembAteP31 += st.alighting || 0;
            isentosAteP31 += st.door1Alighting || 0;
        }
        
        // ✅ Calcular isentos DEPOIS de P31
        let isentosDepoisP31 = isentosViagem - isentosAteP31;
        
        // ✅ Categoria Isentos: TODOS os isentos
        metrics.isentos = isentosViagem;
        
        // 1. Mínima
        metrics.minima = desembAteP31 - isentosAteP31;

        // 2. Figueira
        let figueira = 0;
        if (p42Index !== -1 && p42Index < p31Index) {
            for (let i = p42Index + 1; i <= p31Index; i++) {
                figueira += allStationsData[trip.stationIndices[i]].boarding || 0;
            }
        }
        metrics.figueira = figueira;

        // 3. Divisa
        let divisaIda = 0;
        for (let i = p31Index + 1; i < trip.stationIndices.length; i++) {
            divisaIda += allStationsData[trip.stationIndices[i]].boarding || 0;
        }
        metrics.divisa = divisaIda;

        // 4. ✅ Máxima (subtrai isentos até P31 E isentos depois P31)
        metrics.maxima = embarquesAteP31 - figueira - metrics.minima - isentosAteP31 - isentosDepoisP31;
    }

    /* ===============================
       🔵 VOLTA
    =============================== */
    if (trip.direction === 'volta') {
        let embarquesAteP31 = 0;
        let desembAteP31 = 0;
        let isentosAteP31 = 0;
        
        for (let i = 0; i <= p31Index; i++) {
            const st = allStationsData[trip.stationIndices[i]];
            embarquesAteP31 += st.boarding || 0;
            desembAteP31 += st.alighting || 0;
            isentosAteP31 += st.door1Alighting || 0;
        }
        
        // Calcular isentos DEPOIS de P31
        let isentosDepoisP31 = 0;
        for (let i = p31Index + 1; i < trip.stationIndices.length; i++) {
            isentosDepoisP31 += allStationsData[trip.stationIndices[i]].door1Alighting || 0;
        }
        
        // ✅ Categoria Isentos: TODOS os isentos
        metrics.isentos = isentosAteP31 + isentosDepoisP31;
        
        // 1. Divisa
        metrics.divisa = desembAteP31 - isentosAteP31;

        // 2. Mínima
        let embarquesDepoisP31 = 0;
        for (let i = p31Index + 1; i < trip.stationIndices.length; i++) {
            embarquesDepoisP31 += allStationsData[trip.stationIndices[i]].boarding || 0;
        }
        metrics.minima = embarquesDepoisP31 - isentosDepoisP31;

        // 3. Máxima
        metrics.maxima = embarquesAteP31 - desembAteP31;

        // Figueira não existe na VOLTA
        metrics.figueira = 0;
    }

    console.log(`📊 [FILTRO] Métricas da ${trip.name}:`);
    console.log(`   🔴 Máxima: ${metrics.maxima}`);
    console.log(`   🟢 Figueira: ${metrics.figueira}`);
    console.log(`   🟢 Mínima: ${metrics.minima}`);
    console.log(`   🔵 Divisa: ${metrics.divisa}`);
    console.log(`   ⚪ Isentos: ${metrics.isentos}`);
    console.log(`   ✅ TOTAL: ${metrics.maxima + metrics.figueira + metrics.minima + metrics.divisa + metrics.isentos}`);

    return metrics;
}

function calculateDetailedMetrics() {
    const tariffMovementData = {
        byType: {},
        byPayment: {}
    };
    
    const paymentData = {
        cash: { count: 0, amount: 0 },
        card: { count: 0, amount: 0 }
    };
    
    let totalDesembarquesPorta1 = 0;
    
    // ✅ ITERAR POR TODAS AS 314 ESTAÇÕES DO CSV (não só das viagens)
    allStationsData.forEach(station => {
        // Contar desembarques pela porta 1 (ISENTOS)
        if (station.door1Alighting) {
            totalDesembarquesPorta1 += station.door1Alighting;
        }
        
        // Processar movimentos de tarifa
        if (station.tariffMovements && Array.isArray(station.tariffMovements)) {
            station.tariffMovements.forEach(movement => {
                const code = movement.tariffCode;
                const count = movement.count || 0;
                
                // Agrupar por tipo de tarifa
                if (!tariffMovementData.byType[code]) {
                    tariffMovementData.byType[code] = {
                        code: code,
                        count: 0,
                        description: getTariffDescription(code)
                    };
                }
                tariffMovementData.byType[code].count += count;
                
                // Processar pagamentos (se houver)
                if (movement.paymentType) {
                    if (movement.paymentType === 'cash') {
                        paymentData.cash.count += count;
                        paymentData.cash.amount += (movement.amount || 0);
                    } else if (movement.paymentType === 'card') {
                        paymentData.card.count += count;
                        paymentData.card.amount += (movement.amount || 0);
                    }
                }
            });
        }
    });
    
    console.log('💰 Métricas detalhadas calculadas');
    console.log(`   ⚪ Isentos (desembarques porta 1 - TODAS as 314 estações): ${totalDesembarquesPorta1}`);
    console.log('   📊 Tarifas:', tariffMovementData);
    console.log('   💳 Pagamentos:', paymentData);
    
    return {
        tariffs: tariffMovementData,
        payments: paymentData,
        isentos: totalDesembarquesPorta1,
        desembarquesPorta1: totalDesembarquesPorta1,
        totalIsentos: totalDesembarquesPorta1
    };
}

// ✅ FUNÇÃO DE DEBUG TEMPORÁRIA - Procurar parada mais próxima da P42
function debugFindP42() {
    console.log('🔍 ');
    console.log('🔍 DEBUG: PROCURANDO PARADA 42');
    console.log('🔍 ');
    console.log(`📍 Coordenadas de referência P42: [${referencePoints['parada-42-volta'].lat}, ${referencePoints['parada-42-volta'].lng}]`);
    console.log('🔍 ');
    
    const candidates = [];
    
    allStationsData.forEach((station, index) => {
        // Calcular distância de TODAS as estações até a P42 de referência
        const dist = calculateDistance(
            station.latlng[0],
            station.latlng[1],
            referencePoints['parada-42-volta'].lat,
            referencePoints['parada-42-volta'].lng
        );
        
        candidates.push({
            index: index,
            stationNumber: station.stationNumber,
            distance: dist,
            coords: station.latlng,
            time: station.time1,
            direction: station.direction
        });
    });
    
    // Ordenar por distância (mais próximas primeiro)
    candidates.sort((a, b) => a.distance - b.distance);
    
    // Mostrar as 10 estações mais próximas
    console.log('📍 10 ESTAÇÕES MAIS PRÓXIMAS DA P42 DE REFERÊNCIA:');
    candidates.slice(0, 10).forEach((c, idx) => {
        console.log(`   ${idx + 1}º Est. ${c.stationNumber} - ${c.distance.toFixed(2)}m - ${c.direction} - ${c.time}`);
    });
    
    console.log('🔍 ');
    
    // Verificar especificamente estações com número "42"
    const stations42 = candidates.filter(c => parseInt(c.stationNumber) === 42);
    
    if (stations42.length > 0) {
        console.log('📍 ESTAÇÕES COM NÚMERO 42:');
        stations42.forEach(s => {
            console.log(`   Est. ${s.stationNumber} - ${s.distance.toFixed(2)}m - ${s.direction} - ${s.time} - [${s.coords[0]}, ${s.coords[1]}]`);
        });
    } else {
        console.warn('⚠️ NENHUMA estação com número 42 foi encontrada no CSV!');
    }
    
    console.log('🔍 ');
}
function updateMetricsDisplay(metrics) {
    const minimaIdaEl = document.getElementById('metric-minima-ida');
    const maximaEl = document.getElementById('metric-maxima');
    const divisaEl = document.getElementById('metric-divisa');
    const minimaVoltaEl = document.getElementById('metric-minima-volta');
    const figueiraVoltaEl = document.getElementById('metric-figueira-volta');
    const isentosEl = document.getElementById('metric-isentos');
    
    if (minimaIdaEl) minimaIdaEl.textContent = metrics.minimaIda || 0;
    if (maximaEl) maximaEl.textContent = metrics.maxima || 0;
    if (divisaEl) divisaEl.textContent = metrics.divisa || 0;
    if (minimaVoltaEl) minimaVoltaEl.textContent = metrics.minimaVolta || 0;
    if (figueiraVoltaEl) figueiraVoltaEl.textContent = metrics.figueiraVolta || 0;
    if (isentosEl) isentosEl.textContent = metrics.isentos || 0;
}

function updateDetailedDisplay(detailedMetrics) {
    // Atualizar pagamentos
    const cashTotalEl = document.getElementById('payment-cash-total');
    const cardTotalEl = document.getElementById('payment-card-total');
    const cashRevenueEl = document.getElementById('payment-cash-revenue');
    const cardRevenueEl = document.getElementById('payment-card-revenue');
    
    if (detailedMetrics && detailedMetrics.payments) {
        if (cashTotalEl) cashTotalEl.textContent = detailedMetrics.payments.cash.count || 0;
        if (cardTotalEl) cardTotalEl.textContent = detailedMetrics.payments.card.count || 0;
        if (cashRevenueEl) cashRevenueEl.textContent = formatCurrency(detailedMetrics.payments.cash.amount || 0);
        if (cardRevenueEl) cardRevenueEl.textContent = formatCurrency(detailedMetrics.payments.card.amount || 0);
    }
    
    // Atualizar isentos detalhados
    const isentosCodigoEl = document.getElementById('isentos-codigo-98');
    const isentosPorta1El = document.getElementById('isentos-porta-1');
    const isentosTotalEl = document.getElementById('isentos-total');
    
    if (detailedMetrics) {
        if (isentosCodigoEl) isentosCodigoEl.textContent = detailedMetrics.isentos || 0;
        if (isentosPorta1El) isentosPorta1El.textContent = detailedMetrics.desembarquesPorta1 || 0;
        if (isentosTotalEl) isentosTotalEl.textContent = detailedMetrics.totalIsentos || 0;
    }
    
    console.log('📊 Display detalhado atualizado:', detailedMetrics);
}

// 
// FILTROS
// 
function toggleTariffFilter(tariffCode) {
    const index = selectedTariffTypes.indexOf(tariffCode);
    
    if (index > -1) {
        selectedTariffTypes.splice(index, 1);
    } else {
        selectedTariffTypes.push(tariffCode);
    }
    
    console.log(`🎫 Tarifas selecionadas:`, selectedTariffTypes);
    updateVisualization(currentVisualizationMode);
}

function togglePaymentFilter(method) {
    const index = selectedPaymentMethods.indexOf(method);
    
    if (index > -1) {
        selectedPaymentMethods.splice(index, 1);
    } else {
        selectedPaymentMethods.push(method);
    }
    
    console.log(`💳 Métodos selecionados:`, selectedPaymentMethods);
    calculateDetailedMetrics();
    updateDetailedDisplay();
}

function shouldShowStation(stationIndex) {
    if (selectedTripId !== 'all') {
        const trip = allTrips.find(t => t.id === selectedTripId);
        if (!trip || !trip.stationIndices.includes(stationIndex)) {
            return false;
        }
    }
    
    return true;
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
    
    console.log(`✅ Filtro populado com ${allTrips.length} viagens`);
}

function applyTripFilter() {
    selectedTripId = document.getElementById('filter-trip').value;
    
    if (selectedTripId !== 'all') {
        const trip = allTrips.find(t => t.id === selectedTripId);
        if (trip) {
            console.log(`🎯 Viagem selecionada: ${trip.name}`);
            
            const tripMetrics = calculateTripMetrics(selectedTripId);
            if (tripMetrics) {
                updateMetricsDisplay(tripMetrics);
            }
            
            clearAllRoutes();
            displayRoute(selectedTripId);
            
            showTripSummary(selectedTripId);
        }
    } else {
        console.log('📋 Mostrando todas as viagens');
        
        const allMetrics = calculateMetrics();
        updateMetricsDisplay(allMetrics);
        
        clearAllRoutes();
        displayAllRoutes();
        
        showAllTripsSummary();
    }
    
    updateVisualization(currentVisualizationMode);
    calculateDetailedMetrics();
    updateDetailedDisplay();
}

function resetTripFilter() {
    selectedTripId = 'all';
    const selectEl = document.getElementById('filter-trip');
    if (selectEl) selectEl.value = 'all';
    
    console.log('🔄 Filtro resetado');
    
    clearAllRoutes();
    displayAllRoutes();
    
    showAllTripsSummary();
    
    const allMetrics = calculateMetrics();
    updateMetricsDisplay(allMetrics);
    
    updateVisualization(currentVisualizationMode);
    calculateDetailedMetrics();
    updateDetailedDisplay();
}

function resetAllFilters() {
    resetTripFilter();
    selectedTariffTypes = Object.keys(tariffTypes);
    selectedPaymentMethods = ['cash', 'card'];
    
    Object.keys(tariffTypes).forEach(code => {
        const checkbox = document.getElementById(`tariff-checkbox-${code}`);
        if (checkbox) checkbox.checked = true;
    });
    
    const cashCheckbox = document.getElementById('payment-checkbox-cash');
    const cardCheckbox = document.getElementById('payment-checkbox-card');
    if (cashCheckbox) cashCheckbox.checked = true;
    if (cardCheckbox) cardCheckbox.checked = true;
    
    console.log('🔄 Todos os filtros resetados');
    calculateDetailedMetrics();
    updateDetailedDisplay();
    updateVisualization(currentVisualizationMode);
}

function exportData() {
    alert('🚧 Função de exportação em desenvolvimento');
}

// 
// FORMATAÇÃO
// 
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

// 
// SISTEMA ANTI-SOBREPOSIÇÃO DE MARCADORES
// 
function findNearbyStations(stationIndex, allStations, threshold = 20) {
    const station = allStations[stationIndex];
    if (!station) return [];
    
    const nearby = [];
    
    allStations.forEach((otherStation, otherIndex) => {
        if (otherIndex === stationIndex) return;
        
        const distance = calculateDistance(
            station.latlng[0], station.latlng[1],
            otherStation.latlng[0], otherStation.latlng[1]
        );
        
        if (distance < threshold) {
            nearby.push({
                index: otherIndex,
                station: otherStation,
                distance: distance
            });
        }
    });
    
    return nearby;
}

function getMarkerOffset(stationIndex, allStations) {
    const nearby = findNearbyStations(stationIndex, allStations, 20);
    
    if (nearby.length === 0) {
        return { lat: 0, lng: 0 };
    }
    
    const angle = (stationIndex % 8) * (Math.PI / 4);
    const offsetDistance = 0.0001;
    
    return {
        lat: Math.cos(angle) * offsetDistance,
        lng: Math.sin(angle) * offsetDistance
    };
}

// 
// CRIAR MARCADOR
// 
function createInteractiveMarker(latlng, stationData, index) {
    const color = getMarkerColorByFlow(stationData, currentVisualizationMode);
    const size = getMarkerSizeByFlow(stationData, currentVisualizationMode);
    
    const offset = getMarkerOffset(index, allStationsData);
    const adjustedLatlng = [
        latlng[0] + offset.lat,
        latlng[1] + offset.lng
    ];
    
    const centerX = 80;
    const centerY = 40;
    const radius = size;
    
    const iconHtml = `
        <div style="position: relative; width: 160px; height: 80px;">
            ${stationData.boarding > 0 ? `
                <svg style="position: absolute; top: 0; left: 0; width: 160px; height: 80px; pointer-events: none; z-index: 0;">
                    <line 
                        x1="58" 
                        y1="${centerY}" 
                        x2="${centerX - radius - 2}" 
                        y2="${centerY}" 
                        stroke="#2196F3" 
                        stroke-width="2.5"
                        stroke-linecap="round"
                    />
                    <polygon 
                        points="${centerX - radius - 2},${centerY} ${centerX - radius - 8},${centerY - 4} ${centerX - radius - 8},${centerY + 4}" 
                        fill="#2196F3"
                    />
                </svg>
                
                <div style="
                    position: absolute;
                    left: 2px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
                    color: white;
                    padding: 4px 8px;
                    border-radius: 8px;
                    font-size: 10px;
                    font-weight: 700;
                    white-space: nowrap;
                    box-shadow: 0 2px 6px rgba(33, 150, 243, 0.4);
                    border: 2px solid white;
                    z-index: 2;
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    letter-spacing: 0.3px;
                ">
                    <span style="font-size: 11px;">↗️</span>
                    <span>${stationData.boarding}</span>
                </div>
            ` : ''}
            
            <div style="
                width: ${size * 2}px;
                height: ${size * 2}px;
                border-radius: 50%;
                background: ${color};
                border: 3px solid white;
                box-shadow: 0 0 0 2px ${color}, 0 4px 12px rgba(0,0,0,0.5);
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 3;
                transition: transform 0.2s ease;
            ">
                <div style="
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-size: ${size > 10 ? '9px' : '7px'};
                    font-weight: bold;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                ">
                    ${stationData.stationNumber}
                </div>
            </div>
            
            ${stationData.alighting > 0 ? `
                <svg style="position: absolute; top: 0; left: 0; width: 160px; height: 80px; pointer-events: none; z-index: 0;">
                    <line 
                        x1="${centerX + radius + 2}" 
                        y1="${centerY}" 
                        x2="102" 
                        y2="${centerY}" 
                        stroke="#F44336" 
                        stroke-width="2.5"
                        stroke-linecap="round"
                    />
                    <polygon 
                        points="${centerX + radius + 2},${centerY} ${centerX + radius + 8},${centerY - 4} ${centerX + radius + 8},${centerY + 4}" 
                        fill="#F44336"
                    />
                </svg>
                
                <div style="
                    position: absolute;
                    right: 2px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: linear-gradient(135deg, #F44336 0%, #D32F2F 100%);
                    color: white;
                    padding: 4px 8px;
                    border-radius: 8px;
                    font-size: 10px;
                    font-weight: 700;
                    white-space: nowrap;
                    box-shadow: 0 2px 6px rgba(244, 67, 54, 0.4);
                    border: 2px solid white;
                    z-index: 2;
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    letter-spacing: 0.3px;
                ">
                    <span>${stationData.alighting}</span>
                    <span style="font-size: 11px;">↘️</span>
                </div>
            ` : ''}
        </div>
    `;
    
    const marker = L.marker(adjustedLatlng, {
        icon: L.divIcon({
            html: iconHtml,
            className: 'custom-marker-icon',
            iconSize: [160, 80],
            iconAnchor: [80, 40]
        })
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
        this.bindTooltip(`
            <div style="
                text-align: center; 
                font-weight: bold; 
                font-size: 12px;
                line-height: 1.6;
            ">
                <div style="
                    font-size: 14px; 
                    margin-bottom: 6px; 
                    padding-bottom: 6px; 
                    border-bottom: 2px solid rgba(255,255,255,0.3);
                ">
                    🚏 Estação <strong style="color: #FFD700;">${stationData.stationNumber}</strong>
                </div>
                <div style="
                    display: flex; 
                    flex-direction: column; 
                    gap: 5px; 
                    margin-top: 8px;
                ">
                    <div style="
                        background: rgba(33, 150, 243, 0.2); 
                        padding: 4px 8px; 
                        border-radius: 6px;
                        border-left: 3px solid #2196F3;
                    ">
                        <span style="color: #64B5F6;">↗️ ${stationData.boarding}</span> embarques
                    </div>
                    <div style="
                        background: rgba(244, 67, 54, 0.2); 
                        padding: 4px 8px; 
                        border-radius: 6px;
                        border-left: 3px solid #F44336;
                    ">
                        <span style="color: #EF5350;">↘️ ${stationData.alighting}</span> desembarques
                    </div>
                </div>
            </div>
        `, {
            permanent: false,
            direction: 'top',
            offset: [0, -35],
            className: 'custom-tooltip',
            opacity: 0.98
        }).openTooltip();
    });
    
    marker.on('mouseout', function(e) {
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

// 
// CLUSTERING
// 
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

// 
// FOCO POR ÍNDICE
// 
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

// 
// ESTATÍSTICAS AVANÇADAS
// 
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
                    <span class="ranking-station">🚏 Est. ${station.stationNumber || 'N/A'}</span>
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

// 
// ATUALIZAR VISUALIZAÇÃO
// 
function updateVisualization(mode) {
    console.log(`🎨 Visualização: ${mode || 'both'}`);
    currentVisualizationMode = mode || 'both';
    
    markers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    
    const visibleMarkers = [];
    
    allStationsData.forEach((stationData, index) => {
        if (!shouldShowStation(index)) return;
        
        const newMarker = createInteractiveMarker(stationData.latlng, stationData, index);
        markers[index] = newMarker;
        visibleMarkers.push(newMarker);
    });
    
    visibleMarkers.forEach(marker => marker.addTo(map));
    
    updateLegend('both');
    createStationsList();
    updateAdvancedStatistics();
    
    const visibleCountEl = document.getElementById('visible-count');
    if (visibleCountEl) {
        visibleCountEl.textContent = visibleMarkers.length;
    }
    
    console.log(`✅ ${visibleMarkers.length} de ${allStationsData.length} estações visíveis`);
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
                    <span>> 20 embarques</span>
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
                    <span>> 20 desembarques</span>
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
                    <span>> 100% - Lotado</span>
                </div>
            `;
            break;
    }
    
    legendContainer.innerHTML = legendHTML;
}

// 
// LISTA DE ESTAÇÕES
// 
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

// 
// RESUMO DA VIAGEM
// 
// ✅ FUNÇÃO AUXILIAR: Calcular métricas por porta de uma viagem
function calculateDoorMetricsByTrip(tripId) {
    const trip = allTrips.find(t => t.id === tripId);
    if (!trip) return null;

    const doorMetrics = {
        door1: { boarding: 0, alighting: 0 },
        door2: { boarding: 0, alighting: 0 },
        door3: { boarding: 0, alighting: 0 },
        door4: { boarding: 0, alighting: 0 },
        door5: { boarding: 0, alighting: 0 },
        door6: { boarding: 0, alighting: 0 }
    };

    // Percorrer todas as estações da viagem
    trip.stationIndices.forEach(stationIndex => {
        const station = allStationsData[stationIndex];
        if (station && station.doors) {
            station.doors.forEach((door, doorIndex) => {
                doorMetrics[`door${doorIndex + 1}`].boarding += parseNumber(door.boarding);
                doorMetrics[`door${doorIndex + 1}`].alighting += parseNumber(door.alighting);
            });
        }
    });

    console.log(`🚪 [${trip.name}] Métricas por porta:`, doorMetrics);

    return doorMetrics;
}

// ✅ FUNÇÃO AJUSTADA: showTripSummary
function showTripSummary(tripId) {
    console.log('🔍 showTripSummary chamada com:', tripId);
    
    const trip = allTrips.find(t => t.id === tripId);
    if (!trip) {
        console.warn('⚠️ Viagem não encontrada:', tripId);
        hideTripSummary();
        return;
    }
    
    console.log('✅ Viagem encontrada:', trip);
    
    // ✅ CALCULAR MÉTRICAS DETALHADAS DA VIAGEM
    const metrics = calculateTripMetrics(tripId);
    console.log('📊 Métricas calculadas:', metrics);
    
    // ✅ CALCULAR MÉTRICAS POR PORTA
    const doorMetrics = calculateDoorMetricsByTrip(tripId);
    
    // ✅ ATUALIZAR PAINEL COM MÉTRICAS DA VIAGEM
    if (metrics) {
        updateMetricsPanel(metrics);
    }
    
    const avgPerStation = trip.stationCount > 0 ? Math.round(trip.totalBoarding / trip.stationCount) : 0;
    
    const startTime = trip.actualStartTime ? trip.actualStartTime.split(' ')[1].substring(0, 5) : 'N/A';
    const endTime = trip.actualEndTime ? trip.actualEndTime.split(' ')[1].substring(0, 5) : 'N/A';
    
    const directionFormatted = trip.direction === 'ida' ? '➡️ IDA' : '⬅️ VOLTA';
    
    document.getElementById('summary-boarding').textContent = trip.totalBoarding;
    document.getElementById('summary-alighting').textContent = trip.totalAlighting;
    document.getElementById('summary-stations').textContent = trip.stationCount;
    document.getElementById('summary-plate').textContent = trip.plate;
    document.getElementById('summary-direction').textContent = directionFormatted;
    document.getElementById('summary-period').textContent = `${startTime} → ${endTime}`;
    document.getElementById('summary-average').textContent = avgPerStation;
    
    // ✅ EXIBIR PORTAS COM MÉTRICAS CALCULADAS
    const doorsContainer = document.getElementById('summary-doors');
    if (doorsContainer && doorMetrics) {
        let doorsHTML = '';
        
        Object.keys(doorMetrics).forEach((doorKey, index) => {
            const doorNumber = index + 1;
            const door = doorMetrics[doorKey];
            const total = door.boarding + door.alighting;
            
            if (total > 0) {
                doorsHTML += `
                    <div class="door-card-compact">
                        <div class="door-number-compact">
                            <span>🚪</span> Porta ${doorNumber}
                        </div>
                        <div class="door-stats-compact">
                            <div class="door-stat-row">
                                <span class="door-stat-label">↗️ Embarcaram:</span>
                                <span class="door-stat-value door-stat-boarding">${door.boarding}</span>
                            </div>
                            <div class="door-stat-row">
                                <span class="door-stat-label">↘️ Desceram:</span>
                                <span class="door-stat-value door-stat-alighting">${door.alighting}</span>
                            </div>
                        </div>
                        <div class="door-total-compact">
                            Total: ${total}
                        </div>
                    </div>
                `;
            }
        });
        
        if (doorsHTML === '') {
            doorsHTML = '<p style="text-align: center; color: #999; padding: 16px; font-size: 12px;">⚠️ Dados de portas não disponíveis</p>';
        }
        
        doorsContainer.innerHTML = doorsHTML;
    }
    
    document.getElementById('trip-summary').style.display = 'block';
    
    console.log('✅ Resumo exibido');
}

// ✅ FUNÇÃO AJUSTADA: showAllTripsSummary
function showAllTripsSummary() {
    console.log('🔍 showAllTripsSummary chamada - Agregando todas as viagens');
    
    if (allTrips.length === 0) {
        hideTripSummary();
        return;
    }
    
    // ✅ CALCULAR MÉTRICAS GLOBAIS
    const globalMetrics = calculateMetrics();
    console.log('📊 Métricas globais calculadas:', globalMetrics);
    
    let totalBoarding = 0;
    let totalAlighting = 0;
    let totalStations = 0;
    let plates = [];
    let earliestTime = null;
    let latestTime = null;
    
    const doorTotals = {
        door1: { boarding: 0, alighting: 0 },
        door2: { boarding: 0, alighting: 0 },
        door3: { boarding: 0, alighting: 0 },
        door4: { boarding: 0, alighting: 0 },
        door5: { boarding: 0, alighting: 0 },
        door6: { boarding: 0, alighting: 0 }
    };
    
    // ✅ AGREGAR MÉTRICAS DE TODAS AS VIAGENS
    allTrips.forEach(trip => {
        totalBoarding += trip.totalBoarding;
        totalAlighting += trip.totalAlighting;
        totalStations += trip.stationCount;
        
        if (trip.plate && !plates.includes(trip.plate)) {
            plates.push(trip.plate);
        }
        
        if (!earliestTime || trip.actualStartTime < earliestTime) {
            earliestTime = trip.actualStartTime;
        }
        if (!latestTime || trip.actualEndTime > latestTime) {
            latestTime = trip.actualEndTime;
        }
        
        // ✅ CALCULAR PORTAS DESTA VIAGEM
        const tripDoorMetrics = calculateDoorMetricsByTrip(trip.id);
        if (tripDoorMetrics) {
            Object.keys(tripDoorMetrics).forEach(doorKey => {
                doorTotals[doorKey].boarding += tripDoorMetrics[doorKey].boarding;
                doorTotals[doorKey].alighting += tripDoorMetrics[doorKey].alighting;
            });
        }
    });
    
    console.log('🚪 Totais por porta (todas as viagens):', doorTotals);
    
    const doorBoardingSum = Object.values(doorTotals).reduce((sum, door) => sum + door.boarding, 0);
    const doorAlightingSum = Object.values(doorTotals).reduce((sum, door) => sum + door.alighting, 0);
    
    console.log('🔍 Verificação de totais:', {
        viagens: { boarding: totalBoarding, alighting: totalAlighting },
        portas: { boarding: doorBoardingSum, alighting: doorAlightingSum },
        diferenca: {
            boarding: totalBoarding - doorBoardingSum,
            alighting: totalAlighting - doorAlightingSum
        }
    });
    
    const avgPerStation = totalStations > 0 ? Math.round(totalBoarding / totalStations) : 0;
    
    const startTime = earliestTime ? earliestTime.split(' ')[1].substring(0, 5) : 'N/A';
    const endTime = latestTime ? latestTime.split(' ')[1].substring(0, 5) : 'N/A';
    
    const platesText = plates.length > 0 ? plates.join(', ') : 'N/A';
    
    console.log('📊 Totais finais:', {
        viagens: allTrips.length,
        embarques: totalBoarding,
        desembarques: totalAlighting,
        estacoes: totalStations,
        placas: platesText,
        periodo: `${startTime} → ${endTime}`,
        media: avgPerStation
    });
    
    // ✅ ATUALIZAR ELEMENTOS DO DOM
    const summaryBoardingEl = document.getElementById('summary-boarding');
    const summaryAlightingEl = document.getElementById('summary-alighting');
    const summaryStationsEl = document.getElementById('summary-stations');
    const summaryPlateEl = document.getElementById('summary-plate');
    const summaryDirectionEl = document.getElementById('summary-direction');
    const summaryPeriodEl = document.getElementById('summary-period');
    const summaryAverageEl = document.getElementById('summary-average');
    
    if (summaryBoardingEl) summaryBoardingEl.textContent = totalBoarding;
    if (summaryAlightingEl) summaryAlightingEl.textContent = totalAlighting;
    if (summaryStationsEl) summaryStationsEl.textContent = totalStations;
    if (summaryPlateEl) summaryPlateEl.textContent = platesText;
    if (summaryDirectionEl) summaryDirectionEl.textContent = `${allTrips.length} viagens`;
    if (summaryPeriodEl) summaryPeriodEl.textContent = `${startTime} → ${endTime}`;
    if (summaryAverageEl) summaryAverageEl.textContent = avgPerStation;
    
    // ✅ EXIBIR PORTAS AGREGADAS
    const doorsContainer = document.getElementById('summary-doors');
    if (doorsContainer) {
        let doorsHTML = '';
        
        Object.keys(doorTotals).forEach((doorKey, index) => {
            const doorNumber = index + 1;
            const door = doorTotals[doorKey];
            const total = door.boarding + door.alighting;
            
            if (total > 0) {
                doorsHTML += `
                    <div class="door-card-compact">
                        <div class="door-number-compact">
                            <span>🚪</span> Porta ${doorNumber}
                        </div>
                        <div class="door-stats-compact">
                            <div class="door-stat-row">
                                <span class="door-stat-label">↗️ Embarcaram:</span>
                                <span class="door-stat-value door-stat-boarding">${door.boarding}</span>
                            </div>
                            <div class="door-stat-row">
                                <span class="door-stat-label">↘️ Desceram:</span>
                                <span class="door-stat-value door-stat-alighting">${door.alighting}</span>
                            </div>
                        </div>
                        <div class="door-total-compact">
                            Total: ${total}
                        </div>
                    </div>
                `;
            }
        });
        
        if (doorsHTML === '') {
            doorsHTML = '<p style="text-align: center; color: #999; padding: 16px; font-size: 12px;">⚠️ Dados de portas não disponíveis</p>';
        }
        
        doorsContainer.innerHTML = doorsHTML;
    }
    
    const summaryEl = document.getElementById('trip-summary');
    if (summaryEl) {
        summaryEl.style.display = 'block';
    }
    
    console.log('✅ Resumo agregado exibido');
}

function hideTripSummary() {
    const summaryEl = document.getElementById('trip-summary');
    if (summaryEl) {
        summaryEl.style.display = 'none';
        console.log('🚫 Resumo ocultado');
    }
}

// 
// CARREGAMENTO DO CSV
// 
// 
// CARREGAMENTO DO CSV
// 
Papa.parse('data.csv', {
    download: true,
    header: false,
    skipEmptyLines: true,
    complete: function(results) {
        console.log('📄 CSV carregado!');
        console.log('🔍 Total de linhas no CSV:', results.data.length);
        
        const data = results.data.slice(2);
        
        console.log('🔍 Dados após pular cabeçalho:', data.length, 'linhas');
        
        let totalBoarding = 0;
        let totalAlighting = 0;
        let initialPassengers = 0;
        let firstStationIndex = -1;
        let processedCount = 0;
        let skippedCount = 0;
        
        data.forEach((row, index) => {
            const latlng = parseLatLng(row[6]);
            
            if (!latlng) {
                skippedCount++;
                return;
            }
            
            processedCount++;
            
            const boarding = parseNumber(row[9]);
            const alighting = parseNumber(row[10]);
            const carried = parseNumber(row[11]);
            const occupancy = parseNumber(row[12]);
            
            if (firstStationIndex === -1) {
                firstStationIndex = index;
                initialPassengers = carried;
            }
            
            const stationNumber = row[5] && row[5].trim() !== '' && row[5] !== '0' 
                ? row[5] 
                : (allStationsData.length + 1).toString();
            
           const stationData = {
    line: row[0] || 'N/A',
    plate: row[1] || 'N/A',
    busId: row[2] || 'N/A',
    driver: row[3] || 'Não informado',
    direction: row[4] || 'N/A',
    stationNumber: stationNumber,
    latlng: latlng,
    time1: row[7] || 'N/A',
    time2: row[8] || 'N/A',
    boarding: boarding,
    alighting: alighting,
    carried: carried,
    occupancy: occupancy,
    door1Alighting: parseNumber(row[14]),  // ✅ NOVO: Desembarques porta 1
    doors: [
        { boarding: parseNumber(row[13]), alighting: parseNumber(row[14]) },  // Porta 1
        { boarding: parseNumber(row[15]), alighting: parseNumber(row[16]) },  // Porta 2
        { boarding: parseNumber(row[17]), alighting: parseNumber(row[18]) },  // Porta 3
        { boarding: parseNumber(row[19]), alighting: parseNumber(row[20]) },  // Porta 4
        { boarding: parseNumber(row[21]), alighting: parseNumber(row[22]) },  // Porta 5
        { boarding: parseNumber(row[23]), alighting: parseNumber(row[24]) }   // Porta 6
    ]
};
            
            allStationsData.push(stationData);
            
            totalBoarding += boarding;
            totalAlighting += alighting;
            
            const marker = createInteractiveMarker(latlng, stationData, allStationsData.length - 1);
            markers.push(marker);
            latlngs.push(latlng);
        });
        
        console.log('✅ Processamento do CSV concluído:');
        console.log(`   📊 ${processedCount} estações processadas`);
        console.log(`   ⚠️ ${skippedCount} linhas puladas`);
        
        if (allStationsData.length === 0) {
            console.error('❌ ERRO: Nenhuma estação foi carregada!');
            alert('⚠️ Erro ao carregar dados: Nenhuma estação válida encontrada no arquivo CSV.');
            return;
        }
        
        initializeClusterGroup();
        
        identifyTrips();
        
        // ✅ DEBUG: PROCURAR TODAS AS ESTAÇÕES 31 E 42 NO CSV
        console.log('🔍 ==========================================');
        console.log('🔍 PROCURANDO PARADAS 31 E 42 NO CSV:');
        console.log('🔍 ==========================================');

        const stations31 = [];
        const stations42 = [];

        allStationsData.forEach((station, index) => {
            const num = parseInt(station.stationNumber);
            
            if (num === 31) {
                stations31.push({
                    index: index,
                    coords: station.latlng,
                    time: station.time1,
                    line: station.line,
                    direction: station.direction
                });
            }
            
            if (num === 42) {
                stations42.push({
                    index: index,
                    coords: station.latlng,
                    time: station.time1,
                    line: station.line,
                    direction: station.direction
                });
            }
        });

        console.log(`📍 Encontradas ${stations31.length} estações com número 31:`);
        stations31.forEach(s => {
            console.log(`   Est. 31 - ${s.line} ${s.direction} - ${s.time} - [${s.coords[0]}, ${s.coords[1]}]`);
        });

        console.log(`📍 Encontradas ${stations42.length} estações com número 42:`);
        stations42.forEach(s => {
            console.log(`   Est. 42 - ${s.line} ${s.direction} - ${s.time} - [${s.coords[0]}, ${s.coords[1]}]`);
        });

        console.log('🔍 ==========================================');
        
        // ✅ DEBUG: Verificar coordenadas de referência
        console.log('📍 Coordenadas de Referência:');
        console.log(`   P31 IDA: [${referencePoints['parada-31-ida'].lat}, ${referencePoints['parada-31-ida'].lng}]`);
        console.log(`   P31 VOLTA: [${referencePoints['parada-31-volta'].lat}, ${referencePoints['parada-31-volta'].lng}]`);
        console.log(`   P42 IDA: [${referencePoints['parada-42-ida'].lat}, ${referencePoints['parada-42-ida'].lng}]`);
        console.log('🔍 ==========================================');
        
        populateTripFilter();
        displayAllRoutes();
        
        const initialMetrics = calculateMetrics();
        updateMetricsDisplay(initialMetrics);
        
        calculateDetailedMetrics();
        updateDetailedDisplay();
        
        if (allTrips.length > 0) {
            showAllTripsSummary();
        }
        
        updateVisualization(currentVisualizationMode);
        
        let tripsTotalBoarding = 0;
        let tripsTotalAlighting = 0;

        allTrips.forEach(trip => {
            tripsTotalBoarding += trip.totalBoarding;
            tripsTotalAlighting += trip.totalAlighting;
        });

        const tripsStationCount = allTrips.reduce((sum, trip) => sum + trip.stationCount, 0);
        const tripsAvgOccupancy = tripsStationCount > 0 ? Math.round(tripsTotalBoarding / tripsStationCount) : 0;

        const pointCountEl = document.getElementById('point-count');
        const visibleCountEl = document.getElementById('visible-count');
        const totalBoardingEl = document.getElementById('total-boarding');
        const totalAlightingEl = document.getElementById('total-alighting');
        const avgOccupancyEl = document.getElementById('avg-occupancy');
        
        if (pointCountEl) pointCountEl.textContent = tripsStationCount;
        if (visibleCountEl) visibleCountEl.textContent = tripsStationCount;
        if (totalBoardingEl) totalBoardingEl.textContent = tripsTotalBoarding;
        if (totalAlightingEl) totalAlightingEl.textContent = tripsTotalAlighting;
        if (avgOccupancyEl) avgOccupancyEl.textContent = tripsAvgOccupancy;
        
        console.log(`✅ ${markers.length} estações carregadas!`);
        console.log('📊 ==========================================');
        console.log('📊 COMPARAÇÃO: CSV COMPLETO vs VIAGENS IDENTIFICADAS');
        console.log('📊 ==========================================');
        console.log(`📄 CSV Completo:`);
        console.log(`   Estações: ${allStationsData.length}`);
        console.log(`   Embarques: ${totalBoarding}`);
        console.log(`   Desembarques: ${totalAlighting}`);
        console.log(`🚌 Viagens Identificadas (${allTrips.length} viagens):`);
        console.log(`   Estações: ${tripsStationCount}`);
        console.log(`   Embarques: ${tripsTotalBoarding}`);
        console.log(`   Desembarques: ${tripsTotalAlighting}`);
        console.log(`   Média/estação: ${tripsAvgOccupancy}`);
        console.log(`⚠️ Diferenças (estações não atribuídas):`);
        console.log(`   Estações: ${allStationsData.length - tripsStationCount}`);
        console.log(`   Embarques: ${totalBoarding - tripsTotalBoarding}`);
        console.log(`   Desembarques: ${totalAlighting - tripsTotalAlighting}`);
        console.log('📊 ==========================================');
    },
    error: function(error) {
        console.error('❌ ERRO ao carregar CSV:', error);
        alert('⚠️ Erro ao carregar o arquivo data.csv.');
    }
});