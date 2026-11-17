import type { SsabiRepository, Timeline } from './repository';

export interface TimelineServiceDeps {
  repository: SsabiRepository;
}

export interface TimelineService {
  getTimeline(bookId: string, cutoff: number): Promise<Timeline>;
}

export function createTimelineService(deps: TimelineServiceDeps): TimelineService {
  const { repository } = deps;

  return {
    async getTimeline(bookId: string, cutoff: number): Promise<Timeline> {
      // FR-SPL-002 🚦: repository.findTimeline이 cutoff 적용
      return repository.findTimeline(bookId, cutoff);
    },
  };
}
