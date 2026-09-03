export const getSkillInstallErrorMessage = (error, fallback = '安装技能失败') => {
  const message = String(error?.message || error || '').trim();
  if (/no skill directory found|SKILL\.md.*not found|not found.*SKILL\.md/i.test(message)) {
    return '所选文件夹中未找到 SKILL.md';
  }
  return message || fallback;
};
