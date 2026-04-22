import { Github, Linkedin, Mail, Code, Database, Cpu, Palette } from 'lucide-react';

interface TeamMember {
  name: string;
  role: string;
  bio: string;
  skills: string[];
  github: string;
  linkedin: string;
  avatar: string;
}

const team: TeamMember[] = [
  {
<<<<<<< Updated upstream
    name: 'William Wachenjera',
    role: 'Computer Network Engineer & Project Manager(SFDAASS)',
    bio: 'Specializes in embedded systems and IoT architecture. Leading the hardware integration and sensor network design.',
    skills: ['AI', 'C++', 'Database Management', 'Python', 'Network Design'],
    github: 'https://github.com/williamwachenjera',
    linkedin: 'https://linkedin.com/in/williamwachenjera',
    avatar: 'WW'
  },
  {
    name: 'Ignacio Phiri',
    role: 'Computer Network Engineer, Computer Programmer',
    bio: 'Expert in Network Application development and database management. Building robust APIs and cloud infrastructure.',
    skills: ['Node.js', 'MongoDB', 'Firebase', 'REST API', 'Cloud Services'],
    github: 'https://github.com/iphiri',
    linkedin: 'https://linkedin.com/in/ignaciophiri',
    avatar: 'IP'
  },
  {
    name: 'Neister Mbuzi',
    role: 'Computer Network Engineer, Circuit Designer , Computer Programming',
    bio: 'Passionate about creating circuit designs. Developing the circuit board and its code implementation.',
    skills: ['Arduino', 'ESP32', 'C++', 'UI/UX', 'Responsive Circuit Design'],
    github: 'https://github.com/neistermbuzi',
    linkedin: 'https://linkedin.com/in/neistermbuzi',
    avatar: 'NM'
  },
  {
    name: 'Mirriam Chimoyo',
    role: 'Computer Network Engineer, Circuit Design',
    bio: 'Focuses on circcuit design and machine learning. Designing interactive designs for fire risk assessment.',
    skills: ['Python', 'Machine Learning', 'Statistics','DSA', 'MySQL'],
    github: 'https://github.com/mirriamchimoyo',
    linkedin: 'https://linkedin.com/in/mirriamchimoyo',
    avatar: 'MC'
  },
  
=======
    name: 'Alex Johnson',
    role: 'IoT Engineer & Project Lead',
    bio: 'Specializes in embedded systems and IoT architecture. Leading the hardware integration and sensor network design.',
    skills: ['Arduino', 'ESP32', 'MQTT', 'Sensor Integration', 'Hardware Design'],
    github: 'https://github.com/alexjohnson',
    linkedin: 'https://linkedin.com/in/alexjohnson',
    avatar: 'AJ'
  },
  {
    name: 'Sarah Chen',
    role: 'Backend Developer',
    bio: 'Expert in server-side development and database management. Building robust APIs and cloud infrastructure.',
    skills: ['Node.js', 'MongoDB', 'Firebase', 'REST API', 'Cloud Services'],
    github: 'https://github.com/sarahchen',
    linkedin: 'https://linkedin.com/in/sarahchen',
    avatar: 'SC'
  },
  {
    name: 'Michael Rodriguez',
    role: 'Frontend Developer',
    bio: 'Passionate about creating intuitive user interfaces. Developing the dashboard and mobile applications.',
    skills: ['React', 'TypeScript', 'Tailwind CSS', 'UI/UX', 'Responsive Design'],
    github: 'https://github.com/mrodriguez',
    linkedin: 'https://linkedin.com/in/mrodriguez',
    avatar: 'MR'
  },
  {
    name: 'Emily Watson',
    role: 'Data Scientist',
    bio: 'Focuses on data analytics and machine learning. Implementing predictive algorithms for fire risk assessment.',
    skills: ['Python', 'Machine Learning', 'Data Analysis', 'TensorFlow', 'Statistics'],
    github: 'https://github.com/emilywatson',
    linkedin: 'https://linkedin.com/in/emilywatson',
    avatar: 'EW'
  },
  {
    name: 'David Kim',
    role: 'Systems Integration Specialist',
    bio: 'Expert in integrating hardware and software systems. Ensuring seamless communication between all components.',
    skills: ['System Architecture', 'API Integration', 'DevOps', 'Testing', 'Documentation'],
    github: 'https://github.com/davidkim',
    linkedin: 'https://linkedin.com/in/davidkim',
    avatar: 'DK'
  },
  {
    name: 'Lisa Thompson',
    role: 'UI/UX Designer',
    bio: 'Designs user-centered interfaces and experiences. Creating intuitive and accessible design systems.',
    skills: ['Figma', 'User Research', 'Prototyping', 'Design Systems', 'Accessibility'],
    github: 'https://github.com/lisathompson',
    linkedin: 'https://linkedin.com/in/lisathompson',
    avatar: 'LT'
  },
>>>>>>> Stashed changes
];

const getRoleIcon = (role: string) => {
  if (role.includes('IoT') || role.includes('Integration')) return Cpu;
  if (role.includes('Backend') || role.includes('Data')) return Database;
  if (role.includes('Frontend') || role.includes('Developer')) return Code;
  return Palette;
};

const getAvatarColor = (index: number) => {
  const colors = [
    'bg-red-600',
    'bg-blue-600',
    'bg-green-600',
    'bg-purple-600',
    'bg-orange-600',
    'bg-pink-600',
  ];
  return colors[index % colors.length];
};

export function Team() {
  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-2xl mb-2">Our Team</h1>
        <p className="text-gray-600">Meet the talented individuals behind the Smart Fire Detection System</p>
      </div>

      {/* Team Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {team.map((member, index) => {
          const RoleIcon = getRoleIcon(member.role);
          const avatarColor = getAvatarColor(index);

          return (
            <div key={index} className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow">
              {/* Avatar */}
              <div className="flex flex-col items-center mb-4">
                <div className={`w-24 h-24 ${avatarColor} rounded-full flex items-center justify-center mb-3`}>
                  <span className="text-white text-2xl font-semibold">{member.avatar}</span>
                </div>
                <h3 className="font-semibold text-lg text-center">{member.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <RoleIcon className="w-4 h-4 text-gray-500" />
                  <p className="text-sm text-gray-600">{member.role}</p>
                </div>
              </div>

              {/* Bio */}
              <p className="text-sm text-gray-700 text-center mb-4">{member.bio}</p>

              {/* Skills */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 mb-2">SKILLS</p>
                <div className="flex flex-wrap gap-1.5">
                  {member.skills.map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Social Links */}
              <div className="flex gap-2">
                <a
                  href={member.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Github className="w-4 h-4" />
                  <span className="text-sm">GitHub</span>
                </a>
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Linkedin className="w-4 h-4" />
                  <span className="text-sm">LinkedIn</span>
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* Team Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 text-center">
          <p className="text-3xl font-semibold text-blue-600 mb-1">{team.length}</p>
          <p className="text-sm text-gray-600">Team Members</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 text-center">
          <p className="text-3xl font-semibold text-green-600 mb-1">500+</p>
          <p className="text-sm text-gray-600">Hours Invested</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 text-center">
          <p className="text-3xl font-semibold text-purple-600 mb-1">15+</p>
          <p className="text-sm text-gray-600">Technologies Used</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 text-center">
          <p className="text-3xl font-semibold text-red-600 mb-1">100%</p>
          <p className="text-sm text-gray-600">Dedication</p>
        </div>
      </div>
    </div>
  );
}
