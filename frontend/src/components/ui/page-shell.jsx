import React from 'react';

// The responsive page container, defined once. Nine public//dashboard files previously
// hand-repeated `max-w-7xl mx-auto px-8` — the fixed `px-8` is what produced 131px of
// horizontal overflow at a 375px viewport on Home and Login, because it never scaled down.
// Centralizing it means that class of bug can't silently recur in a tenth file.
const PageShell = ({ as: Tag = 'div', width = '7xl', className = '', children, ...rest }) => {
  const widthClass = {
    '5xl': 'max-w-5xl',
    '7xl': 'max-w-7xl',
    full: 'max-w-none',
  }[width] || 'max-w-7xl';

  return (
    <Tag className={`${widthClass} mx-auto w-full px-4 sm:px-6 lg:px-8 ${className}`} {...rest}>
      {children}
    </Tag>
  );
};

export default PageShell;
