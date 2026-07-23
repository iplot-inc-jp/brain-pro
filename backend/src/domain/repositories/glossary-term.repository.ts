import { GlossaryTerm, GlossaryTermMapping } from '../entities/glossary-term.entity';

export const GLOSSARY_TERM_REPOSITORY = Symbol('IGlossaryTermRepository');

export interface IGlossaryTermRepository {
  /** 用語1件を対応（mappings）付きで取得する。 */
  findById(id: string): Promise<GlossaryTerm | null>;
  /** プロジェクトの用語を対応付きで全件取得する。 */
  findByProjectId(projectId: string): Promise<GlossaryTerm[]>;
  create(term: GlossaryTerm): Promise<void>;
  update(term: GlossaryTerm): Promise<void>;
  delete(id: string): Promise<void>;

  /** 用語対応（mapping）1件を取得する。 */
  findMappingById(id: string): Promise<GlossaryTermMapping | null>;
  createMapping(mapping: GlossaryTermMapping): Promise<void>;
  updateMapping(mapping: GlossaryTermMapping): Promise<void>;
  deleteMapping(id: string): Promise<void>;

  generateId(): string;
}
