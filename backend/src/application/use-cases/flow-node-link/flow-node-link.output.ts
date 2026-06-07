import {
  FlowNodeLink,
  FlowLinkDirectionValue,
} from '../../../domain';

export interface FlowNodeLinkOutput {
  id: string;
  nodeId: string;
  direction: FlowLinkDirectionValue;
  targetFlowId: string;
  targetFlowName: string | null;
  targetNodeId: string | null;
  targetNodeLabel: string | null;
  label: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toFlowNodeLinkOutput(
  link: FlowNodeLink,
  targetFlowName: string | null,
  targetNodeLabel: string | null,
): FlowNodeLinkOutput {
  return {
    id: link.id,
    nodeId: link.nodeId,
    direction: link.direction,
    targetFlowId: link.targetFlowId,
    targetFlowName,
    targetNodeId: link.targetNodeId,
    targetNodeLabel,
    label: link.label,
    order: link.order,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}
