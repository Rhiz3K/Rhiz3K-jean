/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext } from 'react'

const DEFAULT_SIDEBAR_WIDTH = 250

// Default width matches the default in ui-store
const SidebarWidthContext = createContext<number>(DEFAULT_SIDEBAR_WIDTH)

export const SidebarWidthProvider = SidebarWidthContext.Provider
export const useSidebarWidth = () => useContext(SidebarWidthContext)
