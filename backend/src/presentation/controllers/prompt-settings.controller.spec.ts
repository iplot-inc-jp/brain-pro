import { validate } from 'class-validator';
import {
  PromptSettingsController,
  UpdatePromptSettingsDto,
} from './prompt-settings.controller';

describe('PromptSettingsController', () => {
  it('一覧・取得・保存・復元へprojectとkeyとuserを渡す', async () => {
    const prompts = {
      list: jest.fn(async () => ({ prompts: [], allowedModels: [] })),
      getSettings: jest.fn(async () => ({ active: { version: 1 }, history: [] })),
      update: jest.fn(async () => ({ version: 2 })),
      reset: jest.fn(async () => ({ version: 3 })),
    };
    const controller = new (PromptSettingsController as any)(
      prompts,
    ) as PromptSettingsController;
    const user = { id: 'u1' } as any;

    await controller.list('p1');
    await controller.settings(user, 'p1', 'kpi-generate');
    await controller.update(user, 'p1', 'kpi-generate', {
      model: 'claude-haiku-4-5', systemPrompt: 'DB管理のプロンプト',
    });
    await controller.reset(user, 'p1', 'kpi-generate');

    expect(prompts.list).toHaveBeenCalledWith('p1');
    expect(prompts.getSettings).toHaveBeenCalledWith('p1', 'kpi-generate', 'u1');
    expect(prompts.update).toHaveBeenCalledWith('p1', 'kpi-generate', {
      model: 'claude-haiku-4-5', systemPrompt: 'DB管理のプロンプト',
    }, 'u1');
    expect(prompts.reset).toHaveBeenCalledWith('p1', 'kpi-generate', 'u1');
  });

  it.each([
    ['claude-sonnet-4-6', '   '],
    ['claude-sonnet-4-6', 'x'.repeat(20_001)],
  ])('空・過大なプロンプトをDTOで拒否する', async (model, systemPrompt) => {
    const dto = Object.assign(new UpdatePromptSettingsDto(), { model, systemPrompt });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('モデルの確定検証はサービス側に委ねる（DTOは文字列としてのみ検証）', async () => {
    const dto = Object.assign(new UpdatePromptSettingsDto(), {
      model: 'claude-env-override-model', systemPrompt: '有効な本文',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
