/**
 * Codex CLI management service
 *
 * Provides TanStack Query hooks for checking, installing, and managing
 * the embedded Codex CLI binary.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { useCallback, useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import type {
  CodexCliStatus,
  CodexAuthStatus,
  CodexReleaseInfo,
  CodexInstallProgress,
} from '@/types/codex-cli'

// Check if running in Tauri context (vs plain browser)
const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// Query keys for Codex CLI
export const codexCliQueryKeys = {
  all: ['codex-cli'] as const,
  status: () => [...codexCliQueryKeys.all, 'status'] as const,
  auth: () => [...codexCliQueryKeys.all, 'auth'] as const,
  versions: () => [...codexCliQueryKeys.all, 'versions'] as const,
}

/**
 * Hook to check if Codex CLI is installed and get its status
 */
export function useCodexCliStatus() {
  return useQuery({
    queryKey: codexCliQueryKeys.status(),
    queryFn: async (): Promise<CodexCliStatus> => {
      if (!isTauri()) {
        logger.debug('Not in Tauri context, returning mock Codex CLI status')
        return { installed: false, version: null, path: null }
      }

      try {
        logger.debug('Checking Codex CLI installation status')
        const status = await invoke<CodexCliStatus>('check_codex_cli_installed')
        logger.info('Codex CLI status', { status })
        return status
      } catch (error) {
        logger.error('Failed to check Codex CLI status', { error })
        return { installed: false, version: null, path: null }
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    refetchInterval: 1000 * 60 * 60, // Re-check every hour
  })
}

/**
 * Hook to check if Codex CLI is authenticated
 */
export function useCodexCliAuth(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: codexCliQueryKeys.auth(),
    queryFn: async (): Promise<CodexAuthStatus> => {
      if (!isTauri()) {
        logger.debug('Not in Tauri context, returning mock Codex auth status')
        return { authenticated: false, error: 'Not in Tauri context' }
      }

      try {
        logger.debug('Checking Codex CLI authentication status')
        const status = await invoke<CodexAuthStatus>('check_codex_cli_auth')
        logger.info('Codex CLI auth status', { status })
        return status
      } catch (error) {
        logger.error('Failed to check Codex CLI auth', { error })
        return {
          authenticated: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
  })
}

/**
 * Hook to fetch available Codex CLI versions from GitHub releases
 */
export function useAvailableCodexVersions() {
  return useQuery({
    queryKey: codexCliQueryKeys.versions(),
    queryFn: async (): Promise<CodexReleaseInfo[]> => {
      if (!isTauri()) {
        logger.debug('Not in Tauri context, returning empty versions list')
        return []
      }

      try {
        logger.debug('Fetching available Codex CLI versions')
        // Transform snake_case from Rust to camelCase
        const versions = await invoke<
          {
            version: string
            tag_name: string
            published_at: string
            prerelease: boolean
          }[]
        >('get_available_codex_versions')

        return versions.map(v => ({
          version: v.version,
          tagName: v.tag_name,
          publishedAt: v.published_at,
          prerelease: v.prerelease,
        }))
      } catch (error) {
        logger.error('Failed to fetch Codex CLI versions', { error })
        throw error
      }
    },
    staleTime: 1000 * 60 * 15, // 15 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    refetchInterval: 1000 * 60 * 60, // Re-check every hour
  })
}

/**
 * Hook to install Codex CLI
 */
export function useInstallCodexCli() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (version?: string) => {
      if (!isTauri()) {
        throw new Error('Cannot install Codex CLI outside Tauri context')
      }

      logger.info('Installing Codex CLI', { version })
      await invoke('install_codex_cli', { version: version ?? null })
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: codexCliQueryKeys.status() })
      logger.info('Codex CLI installed successfully')
      toast.success('Codex CLI installed successfully')
    },
    onError: error => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to install Codex CLI', { error })
      toast.error('Failed to install Codex CLI', { description: message })
    },
  })
}

/**
 * Hook to listen for installation progress events
 * Returns [progress, resetProgress] tuple to allow resetting state before new install
 */
export function useCodexInstallProgress(): [CodexInstallProgress | null, () => void] {
  const [progress, setProgress] = useState<CodexInstallProgress | null>(null)

  const resetProgress = useCallback(() => {
    setProgress(null)
  }, [])

  useEffect(() => {
    if (!isTauri()) return

    let unlistenFn: (() => void) | null = null
    const listenerId = Math.random().toString(36).substring(7)

    const setupListener = async () => {
      try {
        logger.info('[useCodexInstallProgress] Setting up listener', { listenerId })
        unlistenFn = await listen<CodexInstallProgress>(
          'codex-cli:install-progress',
          event => {
            logger.info('[useCodexInstallProgress] Received progress event', {
              listenerId,
              stage: event.payload.stage,
              message: event.payload.message,
              percent: event.payload.percent,
            })
            setProgress(event.payload)
          }
        )
      } catch (error) {
        logger.error('[useCodexInstallProgress] Failed to setup listener', {
          listenerId,
          error,
        })
      }
    }

    setupListener()

    return () => {
      logger.info('[useCodexInstallProgress] Cleaning up listener', { listenerId })
      if (unlistenFn) {
        unlistenFn()
      }
    }
  }, [])

  return [progress, resetProgress]
}

/**
 * Combined hook for Codex CLI setup flow
 */
export function useCodexCliSetup() {
  const status = useCodexCliStatus()
  const versions = useAvailableCodexVersions()
  const installMutation = useInstallCodexCli()
  const [progress, resetProgress] = useCodexInstallProgress()

  const needsSetup = !status.isLoading && !status.data?.installed

  const install = (
    version: string,
    options?: { onSuccess?: () => void; onError?: (error: Error) => void }
  ) => {
    logger.info('[useCodexCliSetup] install() called', {
      version,
      isPending: installMutation.isPending,
    })

    resetProgress()

    logger.info('[useCodexCliSetup] Calling installMutation.mutate()', { version })
    installMutation.mutate(version, {
      onSuccess: () => {
        logger.info('[useCodexCliSetup] mutate onSuccess callback')
        options?.onSuccess?.()
      },
      onError: error => {
        logger.error('[useCodexCliSetup] mutate onError callback', { error })
        options?.onError?.(error)
      },
    })
  }

  return {
    status: status.data,
    isStatusLoading: status.isLoading,
    versions: versions.data ?? [],
    isVersionsLoading: versions.isLoading,
    needsSetup,
    isInstalling: installMutation.isPending,
    installError: installMutation.error,
    progress,
    install,
    refetchStatus: status.refetch,
  }
}

