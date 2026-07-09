import { PositionSource } from './PositionSource';
import { StockRow, DnpRow, Sale } from '../lib/types';

/**
 * Placeholder for Brian's Azure DB mirror of XBS/SOL (flagged "overdue" in
 * the solution design doc). When it lands, implement the three reads here
 * and switch the ingestion tools' source — nothing else changes.
 */
export class AzureDbSource implements PositionSource {
  async getStock(_ref: string): Promise<StockRow[]> {
    throw new Error('Azure DB mirror not wired yet — upload the XBS stock export instead.');
  }
  async getDailyNetPosition(_ref: string): Promise<DnpRow[]> {
    throw new Error('Azure DB mirror not wired yet — upload the DailyNetPosition export instead.');
  }
  async getLogistics(_ref: string): Promise<Sale[]> {
    throw new Error('Azure DB mirror not wired yet — upload the ReportLogistic export instead.');
  }
}
