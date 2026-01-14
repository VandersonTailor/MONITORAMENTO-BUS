// =========================================================
// SISTEMA DE MONITORAMENTO DE ÔNIBUS - SCRIPT PRINCIPAL
// Código ajustado conforme regras oficiais de métricas
// Mantido Leaflet, visual e estrutura original
// =========================================================

/* ===============================
   VARIÁVEIS GLOBAIS
=============================== */
let map;
let allStationsData = [];
let allTrips = [];

const referencePoints = {
    'parada-31-ida': { lat: -30.078786, lng: -51.116670 },
    'parada-31-volta': { lat: -30.079075, lng: -51.116130 },
    'parada-42-ida': { lat: -30.094485, lng: -51.079701 },
    'parada-42-volta': { lat: -30.094761, lng: -51.080683 }
};

/* ===============================
   INICIALIZAÇÃO DO MAPA (MANTIDO)
=============================== */
function initMap() {
    map = L.map('map').setView([-30.05, -51.15], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

/* ===============================
   UTIL: DISTÂNCIA ENTRE COORDENADAS
=============================== */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/* ===============================
   LEITURA DO CSV
=============================== */
function parseCSV(csvText) {
    const lines = csvText.split('\n').slice(1);
    allStationsData = [];

    lines.forEach(line => {
        if (!line.trim()) return;
        const cols = line.split(';');
        if (cols.length < 15) return;

        allStationsData.push({
            timestamp: cols[0],
            station: Number(cols[1]),
            latlng: [parseFloat(cols[2]), parseFloat(cols[3])],
            boarding: Number(cols[4]) || 0,
            alighting: Number(cols[5]) || 0,
            door1Alighting: Number(cols[6]) || 0
        });
    });
}

/* ===============================
   IDENTIFICAÇÃO DE VIAGENS
=============================== */
function identifyTrips() {
    allTrips = [];
    let currentTrip = null;

    allStationsData.forEach((st, index) => {
        if (!currentTrip) {
            currentTrip = {
                id: 'viagem-' + (allTrips.length + 1),
                direction: allTrips.length % 2 === 0 ? 'ida' : 'volta',
                stationIndices: []
            };
        }
        currentTrip.stationIndices.push(index);

        if (st.station === 1 && currentTrip.stationIndices.length > 10) {
            allTrips.push(currentTrip);
            currentTrip = null;
        }
    });

    if (currentTrip) allTrips.push(currentTrip);
}

/* ===============================
   CÁLCULO DE MÉTRICAS (REGRAS OFICIAIS)
=============================== */
function calculateMetrics() {
    const metrics = {
        minimaIda: 0,
        divisaVolta: 0,
        maxima: 0,
        isentos: 0,
        divisaIda: 0,
        minimaVolta: 0,
        figueiraIda: 0
    };

    // ISENTOS (porta 1 em toda a viagem)
    allStationsData.forEach(st => {
        metrics.isentos += st.door1Alighting || 0;
    });

    allTrips.forEach(trip => {
        let p31Index = -1;
        let p42Index = -1;

        const p31Ref = trip.direction === 'ida'
            ? referencePoints['parada-31-ida']
            : referencePoints['parada-31-volta'];

        trip.stationIndices.forEach((idx, pos) => {
            const st = allStationsData[idx];
            const d31 = calculateDistance(st.latlng[0], st.latlng[1], p31Ref.lat, p31Ref.lng);
            if (d31 < 50 && p31Index === -1) p31Index = pos;

            if (trip.direction === 'ida') {
                const d42 = calculateDistance(
                    st.latlng[0], st.latlng[1],
                    referencePoints['parada-42-ida'].lat,
                    referencePoints['parada-42-ida'].lng
                );
                if (d42 < 50 && p42Index === -1) p42Index = pos;
            }
        });

        if (p31Index === -1) return;

        /* ================= IDA ================= */
        if (trip.direction === 'ida') {
            let desembAteP31 = 0;
            let isentosAteP31 = 0;

            for (let i = 0; i <= p31Index; i++) {
                const st = allStationsData[trip.stationIndices[i]];
                desembAteP31 += st.alighting;
                isentosAteP31 += st.door1Alighting || 0;
            }
            desembAteP31 -= isentosAteP31;

            // Figueira IDA
            let figueira = 0;
            if (p42Index !== -1) {
                for (let i = p42Index + 1; i <= p31Index; i++) {
                    figueira += allStationsData[trip.stationIndices[i]].boarding;
                }
            }
            metrics.figueiraIda += figueira;

            // Divisa IDA
            let divIda = 0;
            for (let i = p31Index + 1; i < trip.stationIndices.length; i++) {
                divIda += allStationsData[trip.stationIndices[i]].boarding;
            }
            metrics.divisaIda += divIda;

            // Mínima IDA
            const minima = Math.max(desembAteP31 - figueira, 0);
            metrics.minimaIda += minima;

            // Máxima IDA = sobra
            metrics.maxima += Math.max(desembAteP31 - minima - figueira, 0);
        }

        /* ================= VOLTA ================= */
        if (trip.direction === 'volta') {
            let desembAteP31 = 0;
            let isentosAteP31 = 0;

            for (let i = 0; i <= p31Index; i++) {
                const st = allStationsData[trip.stationIndices[i]];
                desembAteP31 += st.alighting;
                isentosAteP31 += st.door1Alighting || 0;
            }
            desembAteP31 -= isentosAteP31;

            // Divisa VOLTA
            metrics.divisaVolta += desembAteP31;

            // Mínima VOLTA (embarques a partir da P31)
            let minVolta = 0;
            for (let i = p31Index; i < trip.stationIndices.length; i++) {
                minVolta += allStationsData[trip.stationIndices[i]].boarding;
            }
            metrics.minimaVolta += minVolta;

            // Máxima VOLTA = sobra dos desembarques até P31
            metrics.maxima += Math.max(desembAteP31 - minVolta, 0);
        }
    });

    console.log('📊 MÉTRICAS FINAIS:', metrics);
    return metrics;
}

/* ===============================
   INICIALIZAÇÃO GERAL
=============================== */
function startSystem(csvText) {
    initMap();
    parseCSV(csvText);
    identifyTrips();
    calculateMetrics();
}
