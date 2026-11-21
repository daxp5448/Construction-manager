import React from 'react';
import { FolderOpen } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { NavTarget, useApp } from '../lib/ctx';
import { Button, Page, PageHeader } from '../ui/base';
import { ModuleScreen } from './ModuleScreen';

export function ProjectsScreen({ focus }: { focus: NavTarget }) {
  const { toast } = useApp();
  return (
    <div>
      <PageHeader title="Projects" subtitle="Road projects and work orders. Each project gets its own folder (agreements, BOQ, measurement books, daily progress, site photos) inside its company." />
      <Page>
        <ModuleScreen
          moduleId="projects"
          openId={focus.openId}
          startNew={!!focus.params?.create}
          rowActions={(r) =>
            r.folder_path ? (
              <Button size="sm" icon={<FolderOpen size={12} />} onClick={() => api('system.openPath', { path: r.folder_path }).catch((e) => toast('error', errMsg(e)))}>
                Folder
              </Button>
            ) : null
          }
        />
      </Page>
    </div>
  );
}
