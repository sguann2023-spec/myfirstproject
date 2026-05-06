import React from 'react';
import Markdown from '../Markdown/Markdown';

const MainTextBlock = ({ block }) => {
  return <Markdown content={block?.content || ''} />;
};

export default MainTextBlock;
