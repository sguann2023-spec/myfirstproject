import React, { memo } from 'react'

interface HyperLinkProps {
  children: React.ReactNode
  href: string
}

const Hyperlink: React.FC<HyperLinkProps> = ({ children }) => {
  return children
}

export default memo(Hyperlink)
