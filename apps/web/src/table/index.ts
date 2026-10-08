// Öffentliche API der Tischansicht (WP-016/017). Beschreibung: ARCHITECTURE.md, „Frontend: Tischansicht“.
export { PokerTable, type PokerTableProps } from './PokerTable';
export { TableScreen, type TableScreenProps } from './TableScreen';
export { TableMenu, type TableMenuProps } from './TableMenu';
export { useTableLayout, useDeviceLandscape, LANDSCAPE_QUERY } from './useTableLayout';
export { SeatPlate, type SeatPlateProps } from './SeatPlate';
export { Card, type CardProps, type CardSize } from './Card';
export { BetChips, Board, DealerButton, PotDisplay } from './parts';
export {
  placeSeats,
  seatMarker,
  resolveLayout,
  PORTRAIT_SLOTS,
  LANDSCAPE_SLOTS,
  LANDSCAPE_SLOTS_BY_COUNT,
  LAYOUT_TABLES,
  SLOTS_BY_COUNT,
  type PlacedSeat,
  type Slot,
  type SlotId,
  type TableLayout,
} from './layout';
export { formatChips } from './format';
export * from './types';
