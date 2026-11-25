import PropTypes from 'prop-types';
import React from 'react';
import { Helmet } from 'react-helmet-async';
import useSiteMetadata from '@/hooks/useSiteMetadata';

const Layout = ({
  children,
  variant = 'legacy',
}: React.PropsWithChildren<{ variant?: 'journal' | 'legacy' }>) => {
  const { siteTitle, description } = useSiteMetadata();

  return (
    <>
      <Helmet>
        <html lang="zh-CN" />
        <title>{siteTitle}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content="running" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
      </Helmet>
      <main
        id="main-content"
        className={
          variant === 'journal'
            ? 'journal-layout'
            : 'legacy-layout mx-auto mb-16 max-w-screen-2xl p-4 lg:flex lg:p-16'
        }
      >
        {children}
      </main>
    </>
  );
};

Layout.propTypes = {
  children: PropTypes.node.isRequired,
};

export default Layout;
