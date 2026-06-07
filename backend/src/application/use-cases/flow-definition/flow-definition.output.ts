import { FlowDefinition } from '../../../domain/entities/flow-definition.entity';

export interface FlowDefinitionOutput {
  flowId: string;
  purpose: string | null;
  owner: string | null;
  stakeholders: string | null;
  input: string | null;
  inputDetail: string | null;
  trigger: string | null;
  doSteps: string[];
  output: string | null;
  nextProcess: string | null;
  exceptionHandling: string | null;
  frequency: string | null;
  system: string | null;
  tacitNotes: string | null;
}

export function toFlowDefinitionOutput(flowId: string, def: FlowDefinition | null): FlowDefinitionOutput {
  const f = def?.fields;
  return {
    flowId,
    purpose: f?.purpose ?? null, owner: f?.owner ?? null, stakeholders: f?.stakeholders ?? null,
    input: f?.input ?? null, inputDetail: f?.inputDetail ?? null, trigger: f?.trigger ?? null,
    doSteps: f?.doSteps ?? [], output: f?.output ?? null, nextProcess: f?.nextProcess ?? null,
    exceptionHandling: f?.exceptionHandling ?? null, frequency: f?.frequency ?? null,
    system: f?.system ?? null, tacitNotes: f?.tacitNotes ?? null,
  };
}
