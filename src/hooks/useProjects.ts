import { useCallback, useEffect, useState } from 'react';
import { api, ApiAccessDeniedError } from '../api/client';
import type { ProjectDetail, ProjectSummary } from '../types';

export interface ProjectAccessDenied {
  message: string;
  collectionName?: string;
  adminEmails: string[];
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { projects, loading, error, refresh };
}

export function useProject(projectId: string | undefined) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState<ProjectAccessDenied | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setAccessDenied(null);
    try {
      setProject(await api.getProject(projectId));
    } catch (err) {
      setProject(null);
      if (err instanceof ApiAccessDeniedError) {
        setAccessDenied({
          message: err.message,
          collectionName: err.collectionName,
          adminEmails: err.adminEmails,
        });
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load project');
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { project, loading, error, accessDenied, refresh };
}
