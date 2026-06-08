import { ReportCalendar } from '../entities';

/**
 * ReportCalendar リポジトリインターフェース
 */
export interface IReportCalendarRepository {
  /**
   * IDで検索
   */
  findById(id: string): Promise<ReportCalendar | null>;

  /**
   * プロジェクト内の報告カレンダー一覧（order昇順）
   */
  findByProjectId(projectId: string): Promise<ReportCalendar[]>;

  /**
   * 保存
   */
  save(reportCalendar: ReportCalendar): Promise<void>;

  /**
   * 削除
   */
  delete(id: string): Promise<void>;

  /**
   * IDの生成
   */
  generateId(): string;
}

export const REPORT_CALENDAR_REPOSITORY = Symbol('REPORT_CALENDAR_REPOSITORY');
