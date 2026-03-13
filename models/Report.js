import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { User } from './userModel.js';
import Project from './Project.js';
import Milestone from './Milestone.js';

const Report = sequelize.define('Report', {
  projectId: { 
    type: DataTypes.INTEGER, 
    allowNull: false,
    references: {
      model: 'Projects',
      key: 'id'
    }
  },
  userId: { 
    type: DataTypes.INTEGER, 
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  milestoneId: { 
    type: DataTypes.INTEGER, 
    allowNull: true,
    references: {
      model: 'Milestones',
      key: 'id'
    },
    onDelete: 'SET NULL'
  },
  
  // Basic Information
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  reportType: { 
    type: DataTypes.ENUM('Progress Update', 'Milestone', 'Financial', 'Issue/Risk', 'Completion', 'General'), 
    defaultValue: 'General',
    allowNull: false 
  },
  status: { 
    type: DataTypes.ENUM('Draft', 'Published', 'Archived'), 
    defaultValue: 'Published',
    allowNull: false 
  },
  
  // Progress & Timeline
  progressPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: true, defaultValue: 0 }, // 0.00 to 100.00
  reportPeriodStart: { type: DataTypes.DATE, allowNull: true },
  reportPeriodEnd: { type: DataTypes.DATE, allowNull: true },
  
  // Financial Information
  budgetAllocated: { type: DataTypes.DECIMAL(15, 2), allowNull: true, defaultValue: 0 },
  budgetUsed: { type: DataTypes.DECIMAL(15, 2), allowNull: true, defaultValue: 0 },
  expenditureDetails: { type: DataTypes.TEXT, allowNull: true }, // JSON or detailed text
  
  // Achievements & Milestones
  achievements: { type: DataTypes.TEXT, allowNull: true }, // Accomplishments during this period
  milestonesReached: { type: DataTypes.TEXT, allowNull: true }, // Specific milestones completed
  
  // Challenges & Issues
  challenges: { type: DataTypes.TEXT, allowNull: true }, // Problems encountered
  risksIdentified: { type: DataTypes.TEXT, allowNull: true }, // Potential risks
  mitigationActions: { type: DataTypes.TEXT, allowNull: true }, // Actions taken to address issues
  
  // Future Plans
  nextSteps: { type: DataTypes.TEXT, allowNull: true }, // Planned activities
  recommendations: { type: DataTypes.TEXT, allowNull: true }, // Suggestions for improvement
  
  // Location & Team
  location: { type: DataTypes.STRING, allowNull: true }, // Site/location of activities
  teamMembers: { type: DataTypes.TEXT, allowNull: true }, // JSON array or comma-separated list
  beneficiaries: { type: DataTypes.STRING, allowNull: true }, // Number or description of people impacted
  
  // Media & Attachments
  imageUrl: { type: DataTypes.STRING, allowNull: true }, // Primary image
  additionalImages: { type: DataTypes.TEXT, allowNull: true }, // JSON array of additional image URLs
  videos: { type: DataTypes.TEXT, allowNull: true }, // JSON array of video URLs
  attachments: { type: DataTypes.TEXT, allowNull: true }, // JSON array of document URLs
  
  // Metrics & KPIs
  metricsData: { type: DataTypes.TEXT, allowNull: true }, // JSON object with key metrics
  
  // Approval & Review
  approvalStatus: { 
    type: DataTypes.ENUM('Pending', 'Approved', 'Rejected', 'Under Review'), 
    defaultValue: 'Pending',
    allowNull: true 
  },
  submittedBy: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' } },
  confirmedBy: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' } },
  confirmedAt: { type: DataTypes.DATE, allowNull: true },
  confirmationNote: { type: DataTypes.TEXT, allowNull: true },
  reviewedBy: { type: DataTypes.INTEGER, allowNull: true }, // User ID of reviewer
  reviewNotes: { type: DataTypes.TEXT, allowNull: true },
  
  // Metadata
  tags: { type: DataTypes.STRING, allowNull: true }, // Comma-separated tags for searchability
  priority: { 
    type: DataTypes.ENUM('Low', 'Medium', 'High', 'Critical'), 
    defaultValue: 'Medium',
    allowNull: true 
  },
  isPublic: { type: DataTypes.BOOLEAN, defaultValue: true }, // Visibility to members
  
  // Timestamps
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  timestamps: false
});

// Define associations
Report.belongsTo(Project, { foreignKey: 'projectId' });
Report.belongsTo(User, { foreignKey: 'userId' });
Report.belongsTo(Milestone, { foreignKey: 'milestoneId', as: 'milestone' });
Project.hasMany(Report, { foreignKey: 'projectId' });
User.hasMany(Report, { foreignKey: 'userId' });
Milestone.hasMany(Report, { foreignKey: 'milestoneId' });

export default Report;
