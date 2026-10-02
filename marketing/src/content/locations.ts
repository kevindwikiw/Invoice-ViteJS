import type { Location } from './types'

export const LOCATIONS = [
  {
    id: 'jakarta',
    name: 'Jakarta',
    region: 'DKI Jakarta',
    country: 'Indonesia',
  },
  {
    id: 'bali',
    name: 'Bali',
    region: 'Bali',
    country: 'Indonesia',
  },
] as const satisfies readonly Location[]
