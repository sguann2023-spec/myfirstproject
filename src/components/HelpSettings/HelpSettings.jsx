import './HelpSettings.css';

const HELP_DOCS_URL = 'https://my.feishu.cn/wiki/GIjSwyWU6iunbTk9gqLcRFR7nIg';

const HelpSettings = () => {
  const handleOpenHelpDocs = () => {
    try {
      const { shell } = window.require('electron');
      if (shell?.openExternal) {
        shell.openExternal(HELP_DOCS_URL);
        return;
      }
    } catch {}

    window.open(HELP_DOCS_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="help-settings">
      <div className="help-settings__section">
        <div className="help-settings__section-title">帮助</div>
        <div className="help-settings__card">
          <div className="help-settings__action-row">
            <div className="help-settings__action-desc">
              <div className="help-settings__action-title">帮助文档</div>
            </div>
            <div className="help-settings__action-buttons">
              <button
                type="button"
                className="help-settings__action-button"
                onClick={handleOpenHelpDocs}
              >
                查看
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpSettings;
