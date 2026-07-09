import { StockRow, DnpRow, Sale } from '../lib/types';

/**
 * Data-source adapter for the three position inputs. Tools depend on this
 * interface, not on where the data comes from — today that's file exports
 * uploaded in chat (`UploadedFileSource`, refs are CDN file ids); when
 * Brian's Azure DB mirror lands, `AzureDbSource` plugs in without touching
 * the skills (refs become query hints / dates).
 */
export interface PositionSource {
  /** XBS stock report → raw stock lots. */
  getStock(ref: string): Promise<StockRow[]>;
  /** SOL DailyNetPosition export → hedge-maths rows. */
  getDailyNetPosition(ref: string): Promise<DnpRow[]>;
  /** SOL ReportLogistic export → unallocated forward sales (contract-split rows merged). */
  getLogistics(ref: string): Promise<Sale[]>;
}
