/**
 * Great-circle distance between two lat/lng teams, in kilometers.
 * Mean Earth radius 6371 km. Plenty accurate for "within N km" filtering.
 */
export function haversineKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
): number {
    const R = 6371
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)

    const sinDLat = Math.sin(dLat / 2)
    const sinDLng = Math.sin(dLng / 2)
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
