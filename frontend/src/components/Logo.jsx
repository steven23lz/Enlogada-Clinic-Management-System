import React from 'react';

const Logo = ({ className = 'w-10 h-10' }) => {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer Circle Ring */}
      <circle cx="50" cy="50" r="46" stroke="#769046" strokeWidth="4" />
      
      {/* Central Medical Cross Shapes */}
      {/* Top Left (Green) */}
      <path
        d="M32 46C32 38.268 38.268 32 46 32V46H32Z"
        fill="#769046"
      />
      {/* Bottom Right (Green) */}
      <path
        d="M68 54C68 61.732 61.732 68 54 68V54H68Z"
        fill="#769046"
      />
      {/* Top Right (Navy Blue) */}
      <path
        d="M54 32C61.732 32 68 38.268 68 46H54V32Z"
        fill="#34466B"
      />
      {/* Bottom Left (Navy Blue) */}
      <path
        d="M46 68C38.268 68 32 61.732 32 54H46V68Z"
        fill="#34466B"
      />

      {/* Styled Cross Extensions */}
      {/* Left arm */}
      <rect x="26" y="46" width="6" height="8" rx="3" fill="#34466B" />
      {/* Right arm */}
      <rect x="68" y="46" width="6" height="8" rx="3" fill="#769046" />
      {/* Top arm */}
      <rect x="46" y="26" width="8" height="6" rx="3" fill="#769046" stroke="#34466B" strokeWidth="0" />
      {/* Bottom arm */}
      <rect x="46" y="68" width="8" height="6" rx="3" fill="#34466B" stroke="#769046" strokeWidth="0" />
    </svg>
  );
};

export default Logo;
