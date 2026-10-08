# MONITORAMENTO-BUS: bus passenger-flow dashboard

Interactive dashboard that turns the raw export of on-board passenger counters into maps and statistics: where people board and alight, how full the bus is along the route and what happens on each trip.

**Live demo:** https://vandersontailor.github.io/MONITORAMENTO-BUS/

## Features

- Bus routes and stops drawn from GeoJSON on a Leaflet map, with switchable layers
- Boarding and alighting events plotted by GPS position, with marker clustering
- Filter by trip, with a summary per trip (plate, direction, period, doors used)
- Statistics: total boardings and alightings, average occupancy, top 5 stops, stops with no movement
- Region analysis that highlights the areas with the highest and lowest passenger traffic
- Breakdown by payment type (cash and card)

## Tech stack

- JavaScript (no framework), HTML, CSS
- [Leaflet](https://leafletjs.com/) with the markercluster and draw plugins
- GeoJSON for routes and stops, CSV for the passenger-flow export
- GitHub Pages, deployed by GitHub Actions

## Running locally

The page loads its data with `fetch`, so it needs a local web server:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open the address shown in the terminal.

## Data

- `data.csv`: one day of passenger-flow records exported from the counting platform
- `rotas/`: GeoJSON files with the bus lines and stops

The interface is in Portuguese.
