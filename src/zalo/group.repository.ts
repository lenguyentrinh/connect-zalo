import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupEntity } from './group.entity.js';

@Injectable()
export class GroupRepository {
  constructor(@InjectRepository(GroupEntity) private readonly repo: Repository<GroupEntity>) {}

  upsert(group: { id: string; name: string; totalMember: number }) {
    return this.repo.upsert(group, ['id']);
  }

  findById(id: string) {
    return this.repo.findOneBy({ id });
  }
}
