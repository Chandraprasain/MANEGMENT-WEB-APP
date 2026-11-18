import React from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import type { AddActionSpec } from '../lib/domainRules';
import type { AppTab } from '../types';

interface UniversalAddModalProps {
  actions: AddActionSpec[];
  onSelectAction: (action: AddActionSpec, targetTab: AppTab, opsSection?: 'notices' | 'fees' | 'library' | 'staff' | 'tickets') => void;
  onClose: () => void;
}

export function resolveTabForAddAction(actionId: string): {
  tab: AppTab;
  opsSection?: 'notices' | 'fees' | 'library' | 'staff' | 'tickets';
} {
  switch (actionId) {
    case 'add_student':
    case 'import_students':
      return { tab: 'students' };
    case 'add_teacher':
    case 'add_staff':
      return { tab: 'operations', opsSection: 'staff' };
    case 'add_notice':
    case 'add_event':
      return { tab: 'operations', opsSection: 'notices' };
    case 'add_invoice':
      return { tab: 'operations', opsSection: 'fees' };
    case 'add_book':
      return { tab: 'operations', opsSection: 'library' };
    case 'add_ticket':
      return { tab: 'operations', opsSection: 'tickets' };
    case 'add_class':
    case 'add_homework':
    case 'mark_attendance':
    case 'add_diary':
    case 'add_exam':
      return { tab: 'academics' };
    case 'ask_ai':
      return { tab: 'ai_scanner' };
    case 'create_post':
      return { tab: 'my_school' };
    case 'parent_request':
      return { tab: 'overview' };
    case 'link_child':
      return { tab: 'overview' };
    case 'add_school_admin':
      return { tab: 'schools_admin' };
    case 'add_bank_account':
      return { tab: 'payments' };
    case 'add_assessment':
      return { tab: 'learning_hub' };
    case 'add_workflow':
      return { tab: 'automation_ai' };
    case 'add_safeguarding':
      return { tab: 'trust_hub' };
    default:
      return { tab: 'overview' };
  }
}

export const UniversalAddModal: React.FC<UniversalAddModalProps> = ({ actions, onSelectAction, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Permitted Create Actions</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close actions" className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto">
          {actions.map((act) => {
            const target = resolveTabForAddAction(act.id);
            return (
              <button
                key={act.id}
                type="button"
                onClick={() => onSelectAction(act, target.tab, target.opsSection)}
                className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-left hover:border-blue-600 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{act.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{act.description}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
