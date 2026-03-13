import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const Project = sequelize.define('Project', {
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  category: { type: DataTypes.STRING },
  // Planned timeline for the project
  timelineStart: { type: DataTypes.DATEONLY },
  timelineEnd: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Active' }
}, {
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
});

export default Project;
