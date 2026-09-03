import React from 'react';

const SkillMediaPreview = ({ media = [] }) => {
  if (!Array.isArray(media) || media.length === 0) return null;
  return (
    <div className="skill-detail-media">
      {media.map((item, index) => (
        item?.type === 'video' ? (
          <video
            key={`${item.url}-${index}`}
            className="skill-detail-video"
            src={item.url}
            poster={item.poster_url}
            controls
            playsInline
          />
        ) : (
          <img key={`${item.url}-${index}`} className="skill-detail-image" src={item.url} alt="技能示例" />
        )
      ))}
    </div>
  );
};

export default SkillMediaPreview;

