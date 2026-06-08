import { InformationType } from '../entities/information-type.entity';

export const INFORMATION_TYPE_REPOSITORY = Symbol('IInformationTypeRepository');

export interface IInformationTypeRepository {
  findById(id: string): Promise<InformationType | null>;
  findByProjectId(projectId: string): Promise<InformationType[]>;
  /** 情報種別ごとの添付ファイル件数を projectId 単位で取得 */
  countAttachmentsByProjectId(projectId: string): Promise<Map<string, number>>;
  save(informationType: InformationType): Promise<void>;
  delete(id: string): Promise<void>;
  generateId(): string;
}
