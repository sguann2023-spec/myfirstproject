import { ChevronRight } from 'lucide-react';
import './PolicyAgreement.css';

const agreementCards = [
  {
    key: 'privacy',
    title: '隐私政策',
    url: 'https://www.vectcut.com/privacy',
  },
  {
    key: 'terms',
    title: '服务协议',
    url: 'https://www.vectcut.com/terms-of-service',
  },
  {
    key: 'data-security',
    title: '数据安全',
    url: 'https://www.vectcut.com/data-security',
  },
  {
    key: 'llm-terms',
    title: '大模型条款',
    url: 'https://www.vectcut.com/terms-of-llm',
  },
  {
    key: 'data-processing-addendum',
    title: '数据处理协议',
    url: 'https://www.vectcut.com/data-processing-addendum',
  },
  {
    key: 'pro-special-terms',
    title: '专业版条款',
    url: 'https://www.vectcut.com/pro-special-terms',
  },
];

const PolicyAgreement = () => {
  const handleOpenAgreement = (url) => {
    if (!url) return;

    try {
      if (window.api?.openWebsite) {
        window.api.openWebsite(url);
        return;
      }
    } catch {}

    try {
      const { shell } = window.require('electron');
      if (shell?.openExternal) {
        shell.openExternal(url);
        return;
      }
    } catch {}

    window.open(url, '_blank');
  };

  return (
    <div className="policy-agreement">
      <div className="policy-agreement-card">
        {agreementCards.map((card) => (
          <div key={card.key} className="policy-agreement-row">
            <div className="policy-agreement-row-content">
              <div className="policy-agreement-card-title">{card.title}</div>
              <button
                type="button"
                className="policy-agreement-card-action"
                onClick={() => handleOpenAgreement(card.url)}
                aria-label={`查看${card.title}`}
                title={`查看${card.title}`}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PolicyAgreement;
