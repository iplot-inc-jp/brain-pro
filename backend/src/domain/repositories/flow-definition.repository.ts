import { FlowDefinition } from '../entities/flow-definition.entity';
import { FlowKindValue } from '../entities/business-flow.entity';

export const FLOW_DEFINITION_REPOSITORY = Symbol('FLOW_DEFINITION_REPOSITORY');

/** プロジェクト一覧用に、フロー基本情報と定義を結合した行 */
export interface FlowWithDefinition {
  flowId: string;
  flowName: string;
  kind: FlowKindValue;
  parentId: string | null;
  depth: number;
  definition: FlowDefinition | null;
  // ノードの情報リンク（NodeInformationLink→InformationType）から集計した
  // INPUT/OUTPUT 情報種別名（重複除去済み・これが正）
  inputItems: string[];
  outputItems: string[];
  // フローに紐づく添付ファイル（Attachment.flowId）件数。一覧のバッジ表示用
  attachmentCount: number;
}

export interface IFlowDefinitionRepository {
  findByFlowId(flowId: string): Promise<FlowDefinition | null>;
  findByProjectId(projectId: string): Promise<FlowWithDefinition[]>;
  save(def: FlowDefinition): Promise<void>;
  generateId(): string;
}
