'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type Project = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  organizationId: string;
};

type Organization = {
  id: string;
  name: string;
  slug: string;
  description?: string;
};

type ProjectContextType = {
  organizations: Organization[];
  projects: Project[];
  selectedOrganization: Organization | null;
  selectedProject: Project | null;
  loading: boolean;
  selectOrganization: (org: Organization) => void;
  selectProject: (project: Project) => void;
  fetchOrganizations: () => Promise<void>;
  fetchProjects: (organizationId: string) => Promise<void>;
};

const ProjectContext = createContext<ProjectContextType | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/organizations`, { headers });
      if (res.ok) {
        const data = await res.json();
        setOrganizations(data);
        // 復元: 保存済み organizationId が一覧にあれば選択、無ければ1つの時だけ自動選択
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selectedOrganizationId') : null;
        const saved = savedId ? data.find((o: Organization) => o.id === savedId) : null;
        if (saved) {
          setSelectedOrganization(saved);
        } else if (data.length === 1) {
          setSelectedOrganization(data[0]);
          localStorage.setItem('selectedOrganizationId', data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  const fetchProjects = useCallback(async (organizationId: string) => {
    setLoading(true);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/organizations/${organizationId}/projects`, { headers });
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        // 1つしかない場合は自動選択
        if (data.length === 1) {
          setSelectedProject(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  const selectOrganization = useCallback((org: Organization) => {
    setSelectedOrganization(org);
    localStorage.setItem('selectedOrganizationId', org.id);
    setSelectedProject(null);
    setProjects([]);
    localStorage.removeItem('selectedProjectId');
    fetchProjects(org.id);
  }, [fetchProjects]);

  const selectProject = useCallback((project: Project) => {
    setSelectedProject(project);
    // ローカルストレージに保存
    localStorage.setItem('selectedProjectId', project.id);
  }, []);

  // 初期化: ローカルストレージからプロジェクトIDを復元
  useEffect(() => {
    const init = async () => {
      await fetchOrganizations();
    };
    init();
  }, [fetchOrganizations]);

  // 組織選択時にプロジェクトを取得
  useEffect(() => {
    if (selectedOrganization) {
      fetchProjects(selectedOrganization.id);
    }
  }, [selectedOrganization, fetchProjects]);

  return (
    <ProjectContext.Provider
      value={{
        organizations,
        projects,
        selectedOrganization,
        selectedProject,
        loading,
        selectOrganization,
        selectProject,
        fetchOrganizations,
        fetchProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}

