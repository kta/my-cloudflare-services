export type PublicCoordinates = Readonly<{ latitude: number; longitude: number }>

export function distanceKilometers(from: PublicCoordinates, to: PublicCoordinates): number {
  const radians = Math.PI / 180
  const dLatitude = (to.latitude - from.latitude) * radians
  const dLongitude = (to.longitude - from.longitude) * radians
  const a =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(from.latitude * radians) *
      Math.cos(to.latitude * radians) *
      Math.sin(dLongitude / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
