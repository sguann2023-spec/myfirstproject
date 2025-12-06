import React, { useEffect, useState } from 'react';
import './BannerCarousel.css';

const { shell } = window.require('electron');

function BannerCarousel({ banners = [], interval = 3000 }) {
  const [index, setIndex] = useState(0);

  // 数据变化时归零
  useEffect(() => {
    setIndex(0);
  }, [banners.length]);

  // 自动轮播
  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % banners.length);
    }, interval);
    return () => clearInterval(timer);
  }, [banners.length, interval]);

  const openExternal = (url) => {
    if (!url) return;
    try {
      shell.openExternal(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="banner-carousel">
      <div className="banner-carousel-viewport">
        <div
          className="banner-carousel-track"
          style={{ '--index': index }}
        >
          {banners.map((b, i) => (
            <div
              key={i}
              className="banner-carousel-slide"
              onClick={() => openExternal(b.jump_url)}
            >
              <img src={b.cover} alt={`banner-${i}`} />
            </div>
          ))}
        </div>

        <div className="banner-carousel-dots">
          {banners.map((_, i) => (
            <span
              key={i}
              className={`banner-carousel-dot ${index === i ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default BannerCarousel;