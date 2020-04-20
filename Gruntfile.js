module.exports = function(grunt) {

	const es_modules_postprocess = {
		process( content, srcpath ){
			return content.replace(/^\s*import\b([^'"]*['"])([^\/\.])/gm,
														 "\nimport$1../$2");
		},
	};

	const es_demo_postprocess = {
		process( content, srcpath ){
			return es_modules_postprocess
				.process( content, srcpath )
				.replace(/\.\.\/mv-sorter/g, "../mv-sorter/mv-sorter");
		},
	};

	const dest = "dist/";
	
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
		copy: {
			polymer:{
				expand: true,
				cwd: 'node_modules/',
				src: '@polymer/**/*.js',
				dest: dest,
				options: es_modules_postprocess,
			},
			webcomponents:{
				expand: true,
				cwd: 'node_modules/',
				src: '@webcomponents/**/*.js',
				dest: dest,
			},
			marked:{
				expand: true,
				cwd: 'node_modules/',
				src: 'marked/**/*.js',
				dest: dest,
			},
			prism:{
				expand: true,
				cwd: 'node_modules/',
				src: 'prismjs/**/*.js',
				dest: dest,
			},
			'lodash-es':{
				expand: true,
				cwd: 'node_modules/',
				src: 'lodash-es/*.js',
				dest: dest,
			},
			'mv-sorter':{
				expand: true,
				cwd: '.',
				src: 'mv-sorter.{js,css,html}',
				dest: `${dest}mv-sorter/`,
				options: es_modules_postprocess,
			},
			'demo':{
				expand: true,
				cwd: '.',
				src: 'demo/*',
				dest: dest,
				options: es_demo_postprocess,
			},
		},

		clean: [
			'node_modules',
			'typings/',
			'dist/',
		],
		
	});

	// Load the Grunt plugins.
	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.loadNpmTasks('grunt-contrib-clean');
	
	grunt.registerTask('demo', ['copy']);
}
