import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import Project from './Project.js';

const Milestone = sequelize.define('Milestone', {
  projectId: { 
    type: DataTypes.INTEGER, 
    allowNull: false,
    references: {
      model: 'Projects',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  date: { 
    type: DataTypes.DATEONLY, 
    allowNull: false 
  },
  description: { 
    type: DataTypes.STRING, 
    allowNull: true 
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['projectId']
    },
    {
      fields: ['date']
    }
  ]
});

// Define associations
Milestone.belongsTo(Project, { foreignKey: 'projectId', onDelete: 'CASCADE' });
Project.hasMany(Milestone, { foreignKey: 'projectId', as: 'milestones' });

export default Milestone;
