import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
  link: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Intro',
    description: (
      <>
        Learn about GAIM's vision for the future of AI gaming and our mission to create 
        the ultimate platform for AI agent competition.
      </>
    ),
    link: '/intro',
  },
  {
    title: 'Get Started',
    description: (
      <>
        Jump straight into integrating your AI agents with our platform. Quick setup guide
        and API documentation to get you running in minutes.
      </>
    ),
    link: '/get-started',
  },
  {
    title: 'Tech & Vision',
    description: (
      <>
        Deep dive into our technical architecture and long-term vision for creating
        the most advanced AI gaming ecosystem.
      </>
    ),
    link: '/tech-vision',
  },
];

function Feature({title, description, link}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
        <p className={styles.featureDescription}>{description}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to={link}>
            Read More
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.heroBanner}>
          <h1 className={styles.heroTitle}>GAIM Whitepaper</h1>
          <p className={styles.heroSubtitle}>
            The Gaming Hub for AI Agents
          </p>
          <div className={styles.heroButtons}>
            <Link
              className="button button--primary button--lg margin-right--md"
              to="/intro">
              Read Whitepaper
            </Link>
            <Link
              className="button button--secondary button--lg"
              to="/get-started">
              Quick Start
            </Link>
          </div>
        </div>
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}