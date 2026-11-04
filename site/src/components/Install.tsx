import type { ReactNode } from 'react';
import { Card, Section } from './ui';

function Term({ children }: { children: ReactNode }) {
  return <pre className="mt-2 overflow-x-auto rounded-lg bg-code px-4 py-3 font-mono text-sm leading-relaxed text-ink">{children}</pre>;
}

const Comment = ({ children }: { children: string }) => <span className="text-muted">{children}</span>;

export function Install() {
  return (
    <Section id="install" kicker="Install" title="Two commands on either host">
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="Claude Code">
          <Term>
            <Comment># in a Claude Code session</Comment>
            {'\n/plugin marketplace add https://github.com/skathio/somi\n/plugin install somi@somi'}
          </Term>
          <p className="mt-3">
            Or <code>npm install -g @skathio/somi</code>, then <code>/plugin install somi</code>.
          </p>
        </Card>
        <Card title="GitHub Copilot CLI">
          <Term>{'copilot plugin marketplace add https://github.com/skathio/somi\ncopilot plugin install somi@somi'}</Term>
          <p className="mt-3">
            The plugin brings its tripwire hooks on this host too.
          </p>
        </Card>
      </div>
      <Card title="First steps" className="mt-4">
        <Term>
          {'somi doctor --profile                                   '}
          <Comment># recommended sandbox settings</Comment>
          {'\nsomi doctor                                             '}
          <Comment># run inside an agent session</Comment>
          {'\n/somi Add per-team rate limiting to the webhook endpoint '}
          <Comment># routed for you</Comment>
        </Term>
      </Card>
    </Section>
  );
}
