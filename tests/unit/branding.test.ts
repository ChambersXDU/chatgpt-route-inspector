import { describe, expect, it } from 'vitest';
import { AUTHOR_LINK, AUTHOR_TEXT } from '../../src/ui/shared/branding';

describe('project attribution', () => {
  it('uses the same canonical signature and tools page as the reference projects', () => {
    expect(AUTHOR_TEXT).toBe('Created by @liuqi');
    expect(AUTHOR_LINK).toBe('https://blog.liu-qi.cn/tools/');
  });
});
