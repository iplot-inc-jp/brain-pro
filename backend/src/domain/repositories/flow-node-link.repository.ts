import { FlowNodeLink } from '../entities/flow-node-link.entity';

export const FLOW_NODE_LINK_REPOSITORY = Symbol('FLOW_NODE_LINK_REPOSITORY');

export interface IFlowNodeLinkRepository {
  findById(id: string): Promise<FlowNodeLink | null>;
  /** ノードを起点とするリンク（このノードが nodeId のもの） */
  findByNodeId(nodeId: string): Promise<FlowNodeLink[]>;
  /** このノードを参照しているリンク（targetNodeId のもの） */
  findByTargetNodeId(nodeId: string): Promise<FlowNodeLink[]>;
  save(link: FlowNodeLink): Promise<void>;
  delete(id: string): Promise<void>;
  generateId(): string;
}
