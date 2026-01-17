import { v4 as uuidv4 } from 'uuid';
import { SovereignS3nc } from '../SovereignS3nc';

export interface Task {
  _id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done' | string;
  order: number;
  assignedTo?: string;
  dueDate?: number;
}

export class BoardManager {
  constructor(private db: SovereignS3nc) {}

  async getTasks(boardId: string = 'default'): Promise<Task[]> {
    const tasks = await this.db.collection(`tasks_${boardId}`).getAll<Task>();
    return tasks.sort((a, b) => a.order - b.order);
  }

  async addTask(task: Omit<Task, '_id'>, boardId: string = 'default'): Promise<string> {
    const id = uuidv4();
    await this.db.collection(`tasks_${boardId}`).save({ ...task, _id: id });
    return id;
  }

  async moveTask(taskId: string, newStatus: string, newOrder: number, boardId: string = 'default'): Promise<void> {
    const task = await this.db.collection(`tasks_${boardId}`).get<Task>(taskId);
    if (task) {
        task.status = newStatus;
        task.order = newOrder;
        await this.db.collection(`tasks_${boardId}`).save(task);
    }
  }
}
